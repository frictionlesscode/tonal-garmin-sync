import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
}

export class Movements {
  private byId: Record<string, string> = {};
  private fitMap: Record<string, FitMapping> = {};
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
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
      this.byId = cached.byId;
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
      }
    }
    await this.loadMap();
  }

  async refresh(): Promise<void> {
    const movements = await this.tonal.getMovements();
    this.byId = {};
    for (const m of movements as TonalMovementLoose[]) {
      if (m.id && m.name) this.byId[String(m.id)] = String(m.name);
    }
    await this.writeCache();
  }

  /** Human-readable exercise name, with a stable fallback for unknown ids. */
  nameFor(movementId: string | undefined): string {
    if (!movementId) return 'Exercise';
    return this.byId[movementId] ?? `Movement ${movementId}`;
  }

  /** FIT mapping for a movement, or undefined if none/unmapped. */
  fitFor(movementId: string | undefined): FitMapping | undefined {
    if (!movementId) return undefined;
    const m = this.fitMap[movementId];
    return m && m.category ? m : undefined;
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
    const payload: MovementCache = { fetchedAt: new Date().toISOString(), byId: this.byId };
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(payload), 'utf8');
  }
}
