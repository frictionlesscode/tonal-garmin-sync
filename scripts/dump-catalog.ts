/**
 * Dump the full Tonal movement catalog and the full FIT exercise enum catalog
 * to JSON. Use this when you want to extend the movement map with movements the
 * bundled config/movement-map.json doesn't cover yet.
 *
 *   npm run dump:catalog
 *   npm run dump:catalog -- --out ./out
 *
 * Writes to $DATA_DIR (or --out):
 *   - tonal-movements.json   every movement Tonal exposes to your account, + flags
 *   - fit-exercises.json     { category: [exerciseName, ...] } for every FIT category
 *
 * fit-exercises.json is already checked in at config/fit-exercises.json, so you
 * only need to regenerate it on a newer FIT SDK. tonal-movements.json is Tonal's
 * own catalog data — keep it local, don't commit it.
 *
 * See docs/movement-map.md.
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Profile } from '@garmin/fitsdk';
import { Tonal } from '../src/tonal.js';

function reverseEnum(obj: Record<string, unknown> | undefined): string[] {
  // FIT type tables map value -> name; we want the sorted list of names.
  if (!obj) return [];
  return Object.values(obj)
    .filter((v) => typeof v === 'string')
    .map((v) => v as string)
    .sort();
}

async function main() {
  // Only Tonal credentials are needed here — don't demand a complete .env just
  // to dump a catalog.
  const email = process.env.TONAL_EMAIL;
  const password = process.env.TONAL_PASSWORD;
  if (!email || !password) {
    throw new Error('Set TONAL_EMAIL and TONAL_PASSWORD in env / .env');
  }
  const flagIndex = process.argv.indexOf('--out');
  const outDir = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.DATA_DIR || './data';
  await fs.mkdir(outDir, { recursive: true });

  // ---- FIT exercise catalog ----
  const types = (Profile as unknown as { types: Record<string, Record<string, unknown>> }).types;
  const categories = reverseEnum(types.exerciseCategory);
  const fit: Record<string, string[]> = {};
  for (const cat of categories) {
    // FIT names the per-category name table `<camelCat>ExerciseName`.
    const key = `${cat}ExerciseName`;
    fit[cat] = reverseEnum(types[key]);
  }
  await fs.writeFile(path.join(outDir, 'fit-exercises.json'), JSON.stringify(fit, null, 2));
  const totalNames = Object.values(fit).reduce((a, n) => a + n.length, 0);
  console.log(`FIT: ${categories.length} categories, ${totalNames} exercise names`);
  console.log('FIT categories:', categories.join(', '));

  // ---- Tonal movement catalog ----
  const tonal = await Tonal.connect(email, password);
  const movements = (await tonal.getMovements()) as Array<Record<string, unknown>>;
  await fs.writeFile(path.join(outDir, 'tonal-movements.json'), JSON.stringify(movements, null, 2));
  console.log(`\nTonal: ${movements.length} movements -> ${path.join(outDir, 'tonal-movements.json')}`);
  if (movements[0]) console.log('movement fields:', Object.keys(movements[0]).join(', '));
}

main().catch((err) => {
  console.error('dump-catalog failed:', err);
  process.exit(1);
});
