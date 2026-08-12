import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from '@garmin/fitsdk';
import type { Tonal } from './tonal.js';
import type { TonalMovementLoose } from './types.js';

/**
 * Movement catalog: maps Tonal movementId -> human exercise name (cached to
 * disk), and -> FIT exercise mapping (category + specific name + weight mode)
 * via movement-map.json.
 *
 * The map is looked up in two places, in order: $DATA_DIR/movement-map.json (your
 * own, produced by `npm run build:curated`), then the map bundled with the repo at
 * config/movement-map.json. The bundled one is what makes a fresh install produce
 * correctly-labelled exercises without any setup.
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface MovementCache {
  fetchedAt: string;
  byId: Record<string, string>; // movementId -> name
  armsSameTime: Record<string, boolean>; // movementId -> both arms pull simultaneously
}

/** One entry in movement-map.json (per Tonal movementId). */
export interface FitMapping {
  name: string;
  /** FIT exercise_category enum (camelCase), or null if unmapped (Unknown). */
  category: string | null;
  /** FIT exercise_name (camelCase), informational. */
  exerciseName: string | null;
  /** numeric exercise_name value within the category, for the SET message. */
  subtype: number | null;
  /** false for bodyweight movements -> log weight 0. Weight is otherwise baseWeight as-is. */
  onMachine: boolean;
  /** True when this came from the keyword/fuzzy fallback, not config/curated.json. */
  guessed?: boolean;
}

/**
 * Ordered keyword -> FIT category rules used only for movements with no
 * curated mapping. Checked in order; the first match wins, so more specific
 * phrases (e.g. "leg raise") must come before more general ones they'd
 * otherwise be swallowed by (e.g. bare "raise" isn't a rule at all, on
 * purpose — it's too ambiguous across calfRaise/lateralRaise/hipRaise/legRaise
 * to guess safely). A movement matching nothing here stays fully Unknown,
 * exactly like before this fallback existed.
 */
const CATEGORY_KEYWORDS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /overhead press|shoulder press|military press/, category: 'shoulderPress' },
  { pattern: /bench press|chest press/, category: 'benchPress' },
  { pattern: /deadlift/, category: 'deadlift' },
  { pattern: /squat|leg press/, category: 'squat' },
  { pattern: /lunge/, category: 'lunge' },
  { pattern: /calf raise/, category: 'calfRaise' },
  { pattern: /lateral raise|lat raise/, category: 'lateralRaise' },
  { pattern: /leg raise/, category: 'legRaise' },
  { pattern: /hip raise|glute bridge/, category: 'hipRaise' },
  { pattern: /leg curl|hamstring curl/, category: 'legCurl' },
  { pattern: /curl/, category: 'curl' },
  { pattern: /pulldown|pull.?up/, category: 'pullUp' },
  { pattern: /push.?up/, category: 'pushUp' },
  { pattern: /row/, category: 'row' },
  { pattern: /triceps extension|skull crusher|kickback/, category: 'tricepsExtension' },
  { pattern: /flye|\bfly\b/, category: 'flye' },
  { pattern: /shrug/, category: 'shrug' },
  { pattern: /\bchop\b/, category: 'chop' },
  { pattern: /crunch/, category: 'crunch' },
  { pattern: /sit.?up/, category: 'sitUp' },
  { pattern: /plank|static hold/, category: 'plank' },
  { pattern: /\bcarry\b/, category: 'carry' },
  { pattern: /hyperextension|back extension|good morning/, category: 'hyperextension' },
  { pattern: /clean|snatch|jerk/, category: 'olympicLift' },
  { pattern: /\bjump\b|plyo/, category: 'plyo' },
  { pattern: /shoulder stability/, category: 'shoulderStability' },
  { pattern: /stability|dead bug|bird dog/, category: 'hipStability' },
  { pattern: /\bswing\b/, category: 'hipSwing' },
  { pattern: /\bsled\b/, category: 'sled' },
  { pattern: /battle rope/, category: 'battleRope' },
  { pattern: /suspension|\btrx\b/, category: 'suspension' },
  { pattern: /\bband\b|banded/, category: 'bandedExercises' },
  { pattern: /sandbag/, category: 'sandbag' },
  { pattern: /total body/, category: 'totalBody' },
  { pattern: /\bcore\b/, category: 'core' },
  // Checked last on purpose: an "Aero <X>" movement that already matched a more
  // specific pattern above (Aero Chop -> chop, Aero Lunge -> lunge) keeps that
  // more informative category. Only Aero movements naming nothing recognizable
  // (Aero Mini Pull, Aero Twist, ...) fall through to here. `cardio` is FIT's
  // continuous/interval-work category — the closest match to Tonal's Aero
  // cable-cardio style, though FIT has no name in it specific enough to match,
  // so this is category-only.
  { pattern: /^aero\b/, category: 'cardio' },
];

interface FitNameCandidate {
  name: string;
  value: number;
}

let fitNamesByCategory: Map<string, FitNameCandidate[]> | undefined;

/** category -> [{name, numeric value}], read once from the FIT SDK's profile. */
function loadFitNamesByCategory(): Map<string, FitNameCandidate[]> {
  if (fitNamesByCategory) return fitNamesByCategory;
  const types = (Profile as unknown as { types: Record<string, Record<string, unknown>> }).types;
  const map = new Map<string, FitNameCandidate[]>();
  for (const key of Object.keys(types)) {
    const m = key.match(/^(.+)ExerciseName$/);
    if (!m) continue;
    const entries: FitNameCandidate[] = [];
    for (const [value, nm] of Object.entries(types[key])) {
      if (typeof nm === 'string') entries.push({ name: nm, value: Number(value) });
    }
    map.set(m[1], entries);
  }
  fitNamesByCategory = map;
  return map;
}

/** Lowercased word set: splits camelCase and any non-alphanumeric separator. */
function splitWords(s: string): Set<string> {
  return new Set(
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^a-zA-Z0-9]+/)
      .map((w) => w.toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Best-effort fallback for a movement config/curated.json doesn't cover: guess
 * a FIT category from keywords in Tonal's name, then — only when a candidate
 * shares at least one word with it — the closest specific exercise name within
 * that category. A category guess with no specific name is still far more
 * useful than "Unknown" in Garmin, and never crosses into a different exercise
 * family the way an unconstrained fuzzy match over all 900+ FIT names could.
 */
export function guessFitMapping(tonalName: string): FitMapping | undefined {
  const rule = CATEGORY_KEYWORDS.find((r) => r.pattern.test(tonalName.toLowerCase()));
  if (!rule) return undefined;

  const nameWords = splitWords(tonalName);
  const candidates = loadFitNamesByCategory().get(rule.category) ?? [];
  let best: FitNameCandidate | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    let score = 0;
    for (const w of splitWords(c.name)) if (nameWords.has(w)) score++;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }

  return {
    name: tonalName,
    category: rule.category,
    exerciseName: best ? best.name : null,
    subtype: best ? best.value : null,
    // Unknown either way, but defaulting to true (send Tonal's weight as-is)
    // is the safer guess than silently zeroing a weight that should count.
    onMachine: true,
    guessed: true,
  };
}

export class Movements {
  private byId: Record<string, string> = {};
  private armsSameTime: Record<string, boolean> = {};
  private fitMap: Record<string, FitMapping> = {};
  private readonly guessCache = new Map<string, FitMapping | null>();
  private readonly cacheFile: string;
  private readonly mapFile: string;
  private readonly bundledMapFile: string;

  constructor(
    private readonly tonal: Tonal,
    dataDir: string,
  ) {
    this.cacheFile = path.join(dataDir, 'movements-cache.json');
    this.mapFile = path.join(dataDir, 'movement-map.json');
    // Resolve relative to this module (src/ -> repo root), not the working
    // directory, so the bundled map is found however the service was started.
    this.bundledMapFile = fileURLToPath(new URL('../config/movement-map.json', import.meta.url));
  }

  async load(): Promise<void> {
    const cached = await this.readCache();
    // armsSameTime was added after the cache format shipped — treat a cache
    // written by an older version as stale so weight-doubling data gets
    // backfilled immediately rather than silently under-reporting weight for
    // up to CACHE_TTL_MS until it would have refreshed anyway.
    const usable = cached && cached.armsSameTime && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS;
    if (usable) {
      this.byId = cached!.byId;
      this.armsSameTime = cached!.armsSameTime;
    } else {
      try {
        await this.refresh();
      } catch (err) {
        // A stale name cache is far better than failing the whole sync because
        // Tonal's catalog endpoint was briefly unreachable.
        if (!cached) throw err;
        console.warn(
          `[movements] catalog refresh failed (${(err as Error).message}); using cached names from ${cached.fetchedAt}`,
        );
        this.byId = cached.byId;
        this.armsSameTime = cached.armsSameTime ?? {};
      }
    }
    await this.loadMap();
  }

  async refresh(): Promise<void> {
    const movements = await this.tonal.getMovements();
    this.byId = {};
    this.armsSameTime = {};
    for (const m of movements as TonalMovementLoose[]) {
      if (!m.id) continue;
      if (m.name) this.byId[String(m.id)] = String(m.name);
      this.armsSameTime[String(m.id)] = m.onMachineInfo?.trainerArmsPulledAtSameTime === true;
    }
    await this.writeCache();
  }

  /**
   * True when Tonal's own catalog says both of the machine's arms pull this
   * movement simultaneously, each at `baseWeight` — meaning the true combined
   * load is 2x baseWeight, not baseWeight. False (including for unknown ids)
   * means baseWeight already is the total (single arm active, e.g. rope or an
   * alternating movement). Verified against Tonal's own totalVolume field
   * (totalVolume == baseWeight * reps * 2 exactly when this is true, and
   * == baseWeight * reps when false, across every exercise checked).
   */
  doublesWeight(movementId: string | undefined): boolean {
    if (!movementId) return false;
    return this.armsSameTime[movementId] === true;
  }

  /**
   * Human-readable exercise name, with a stable fallback for unknown ids.
   * `descriptionHint` is the set's own Tonal `description` field — the only
   * place a generic "Move" placeholder's real exercise identity lives, since
   * the movement itself is just "Handle Move"/"Bar Move"/etc. Preferred over
   * the catalog name whenever present.
   */
  nameFor(movementId: string | undefined, descriptionHint?: string): string {
    const hint = descriptionHint?.trim();
    if (hint) return hint;
    if (!movementId) return 'Exercise';
    return this.byId[movementId] ?? `Movement ${movementId}`;
  }

  /**
   * FIT mapping for a movement: curated first, else a best-effort keyword/fuzzy
   * guess (logged once per distinct movement+description — see
   * guessFitMapping), else undefined (Unknown in Garmin). See `nameFor` on
   * `descriptionHint`.
   */
  fitFor(movementId: string | undefined, descriptionHint?: string): FitMapping | undefined {
    if (!movementId) return undefined;
    const curated = this.fitMap[movementId];
    if (curated && curated.category) return curated;
    return this.guessFor(movementId, curated?.name, descriptionHint);
  }

  private guessFor(
    movementId: string,
    curatedName: string | undefined,
    descriptionHint: string | undefined,
  ): FitMapping | undefined {
    const hint = descriptionHint?.trim();
    // A generic movement (Handle Move, Bar Move, ...) is reused across
    // unrelated custom exercises, so the cache key must include the
    // description — keying by movementId alone would freeze the first
    // exercise's guess onto every later, unrelated one sharing that id.
    const cacheKey = `${movementId}::${hint ?? ''}`;
    if (this.guessCache.has(cacheKey)) return this.guessCache.get(cacheKey) ?? undefined;

    const label = hint || this.byId[movementId] || curatedName;
    const guess = label ? guessFitMapping(label) : undefined;
    this.guessCache.set(cacheKey, guess ?? null);

    if (guess) {
      console.log(
        `[movements] guessed "${label}"${hint ? ` (from set description; movement "${this.byId[movementId] ?? movementId}")` : ` (${movementId})`} -> ${guess.category}` +
          (guess.exerciseName ? `/${guess.exerciseName}` : ' (category only, no name matched)') +
          ' — unmapped; add a config/curated.json entry to override. See docs/movement-map.md.',
      );
    } else if (label) {
      console.log(`[movements] no keyword match for "${label}" (${movementId}) — showing Unknown`);
    }

    return guess;
  }

  private async loadMap(): Promise<void> {
    for (const file of [this.mapFile, this.bundledMapFile]) {
      try {
        this.fitMap = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, FitMapping>;
        console.log(`[movements] loaded ${Object.keys(this.fitMap).length} FIT mappings from ${file}`);
        return;
      } catch {
        /* try next */
      }
    }
    console.warn(
      '[movements] no movement-map.json found in DATA_DIR or config/; exercises will show as ' +
        'Unknown in Garmin. See docs/movement-map.md.',
    );
  }

  private async readCache(): Promise<MovementCache | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) as MovementCache;
    } catch {
      return undefined;
    }
  }

  private async writeCache(): Promise<void> {
    const payload: MovementCache = {
      fetchedAt: new Date().toISOString(),
      byId: this.byId,
      armsSameTime: this.armsSameTime,
    };
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(payload), 'utf8');
  }
}
