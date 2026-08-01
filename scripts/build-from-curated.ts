/**
 * Build movement-map.json from the curated movement list.
 *
 *   npm run build:curated
 *   npm run build:curated -- --in config/curated.json --out config/movement-map.json
 *
 * Input (config/curated.json by default) is a list of:
 *   [{ movementId, name, exerciseName, categoryHint, onMachine }]
 *
 * For each row the FIT category is derived from the chosen `exerciseName` — the
 * category whose exercise_name table contains that name — preferring
 * `categoryHint` when it's valid, otherwise a "real" strength category over
 * banded/suspension/etc. The numeric `subtype` is the name's value within that
 * category. (FIT requires category and subtype to agree, which is why the hint
 * is only a hint.)
 *
 * Output (DATA_DIR/movement-map.json by default, which the service prefers over
 * the bundled map) is keyed by movementId:
 *   { name, category, exerciseName, subtype, onMachine }
 * Weight handling downstream: baseWeight as-is; onMachine === false -> 0.
 *
 * See docs/movement-map.md.
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from '@garmin/fitsdk';

/** Repo-relative path, resolved from this module rather than the working dir. */
function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

/** Read `--flag value` from argv. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Prefer normal strength categories over these when a name lives in several.
const DEPRIORITIZE = new Set([
  'bandedExercises', 'suspension', 'sandbag', 'sled', 'sledgeHammer', 'tire',
  'battleRope', 'pose', 'move', 'warmUp', 'cardio',
]);

interface Home { category: string; value: number }
interface CuratedRow {
  movementId: string;
  name: string;
  exerciseName: string;
  categoryHint?: string;
  onMachine: boolean;
}

async function main() {
  const inPath = flag('in') ?? repoPath('config/curated.json');
  const outPath = flag('out') ?? path.join(process.env.DATA_DIR || '/data', 'movement-map.json');
  const types = (Profile as unknown as { types: Record<string, Record<string, string>> }).types;

  // exerciseName -> [{ category, numeric value }]
  const homes = new Map<string, Home[]>();
  for (const key of Object.keys(types)) {
    const m = key.match(/^(.+)ExerciseName$/);
    if (!m) continue;
    const category = m[1];
    for (const [value, nm] of Object.entries(types[key])) {
      if (typeof nm !== 'string') continue;
      const arr = homes.get(nm) ?? [];
      arr.push({ category, value: Number(value) });
      homes.set(nm, arr);
    }
  }
  // lowercased name -> canonical name, to tolerate casing typos (stepup -> stepUp)
  const canonical = new Map<string, string>();
  for (const nm of homes.keys()) canonical.set(nm.toLowerCase(), nm);

  const rawCurated = await fs.readFile(inPath, 'utf8');
  // Tolerate a leading UTF-8 BOM (some editors and PowerShell add one).
  const curated = JSON.parse(rawCurated.slice(rawCurated.indexOf('['))) as CuratedRow[];

  const map: Record<string, unknown> = {};
  const invalid: string[] = [];
  const derived: string[] = []; // rows where category != hint

  for (const r of curated) {
    // Resolve to the canonical FIT name (fixes casing like stepup -> stepUp).
    const exerciseName = homes.has(r.exerciseName)
      ? r.exerciseName
      : canonical.get(r.exerciseName.toLowerCase()) ?? r.exerciseName;
    const opts = homes.get(exerciseName);
    if (!opts || opts.length === 0) {
      invalid.push(`${r.name} -> ${r.exerciseName}`);
      continue;
    }
    const pick =
      (r.categoryHint && opts.find((o) => o.category === r.categoryHint)) ||
      opts.find((o) => !DEPRIORITIZE.has(o.category)) ||
      opts[0];

    if (r.categoryHint && pick.category !== r.categoryHint) {
      derived.push(`${r.name}: ${r.categoryHint || '(none)'} -> ${pick.category} (${exerciseName})`);
    }

    map[r.movementId] = {
      name: r.name,
      category: pick.category,
      exerciseName,
      subtype: pick.value,
      onMachine: r.onMachine,
    };
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(map, null, 2));
  console.log(`Read  ${inPath}: ${curated.length} rows`);
  console.log(`Wrote ${outPath}: ${Object.keys(map).length} movements`);
  if (invalid.length) {
    console.log(
      `\nSKIPPED — not a valid FIT exercise name: ${invalid.length}\n  ${invalid.join('\n  ')}\n` +
        `  (check the spelling against config/fit-exercises.json — see docs/movement-map.md)`,
    );
  }
  console.log(`\nCategory derived from the exercise name (differs from categoryHint): ${derived.length}`);
  for (const d of derived) console.log('  ' + d);
}

main().catch((err) => {
  console.error('build-from-curated failed:', err);
  process.exit(1);
});
