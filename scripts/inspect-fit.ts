/**
 * Build the FIT file for your latest completed Tonal workout and decode it back,
 * printing a per-exercise summary — WITHOUT uploading anything. This is the best
 * way to check the movement map, per-set timing, and weights before you sync.
 *
 *   npm run inspect:fit
 *
 * Any exercise flagged UNKNOWN has no FIT mapping and will show as "Unknown" in
 * Garmin. See docs/movement-map.md to add it.
 *
 * PRIVACY: this prints your workout name, exercises, weights and HR counts.
 */
import 'dotenv/config';
import { Decoder, Stream } from '@garmin/fitsdk';
import { loadConfig } from '../src/config.js';
import { Tonal, activityIdOf } from '../src/tonal.js';
import { Movements } from '../src/movements.js';
import { normalizeWorkout, encodeFit } from '../src/fit.js';

async function main() {
  const cfg = loadConfig();
  const tonal = await Tonal.connect(cfg.tonalEmail, cfg.tonalPassword);
  const movements = new Movements(tonal, cfg.dataDir);
  await movements.load();

  const summary = await tonal.getLatestCompletedActivity();
  if (!summary) return console.log('no completed activity');
  const detail = await tonal.getWorkoutDetail(activityIdOf(summary));
  const wo = normalizeWorkout(summary, detail, movements, cfg.tonalWeightUnit, cfg.calorieFactor);

  const bytes = encodeFit(wo, cfg.garminDisplayUnit);
  const { messages, errors } = new Decoder(Stream.fromByteArray(bytes)).read();
  const recordCount = (messages.recordMesgs ?? []).length;
  console.log(`Workout: ${wo.name}  sets=${wo.sets.length}  decodeErrors=${errors.length}`);
  console.log(`genre: ${wo.genre} -> sport=${wo.sport}/${wo.subSport}  (${wo.genreReason})`);
  console.log(`duration=${Math.round(wo.durationSec)}s  totalReps=${wo.totalReps}`);
  const caloriesNote = !wo.sendCalories
    ? 'not sent — Garmin computes this from HR'
    : wo.genre !== 'strength'
      ? 'sent — no HR recorded for this session, nothing for Garmin to compute from'
      : wo.calorieFactor !== 1 && wo.rawCalories !== undefined
        ? `${wo.rawCalories} raw x ${wo.calorieFactor}`
        : 'sent';
  console.log(
    `HR: ${wo.hrSamples.length} samples -> ${recordCount} record msgs | avg=${wo.avgHr} max=${wo.maxHr} | calories=${wo.sendCalories && wo.calorieToSend ? Math.round(wo.calorieToSend) : '-'} (${caloriesNote})`,
  );
  if (wo.sets.length) {
    const first = wo.sets[0].startTime.getTime();
    const last = wo.sets[wo.sets.length - 1];
    const lastEnd = last.startTime.getTime() + last.durationSec * 1000;
    const warmup = Math.round((first - wo.startTime.getTime()) / 1000);
    const cooldown = Math.round((wo.startTime.getTime() + wo.durationSec * 1000 - lastEnd) / 1000);
    console.log(`Warm-up gap (start->first set): ${warmup}s   Cool-down gap (last set->end): ${cooldown}s`);
  }
  const setMsgs = messages.setMesgs ?? [];
  const blocks = setMsgs.filter(
    (s: any) => Array.isArray(s.category) && s.category.includes('warmUp') && !s.repetitions,
  );
  console.log(`Set msgs: ${setMsgs.length} (incl ${blocks.length} warm-up/cool-down blocks), laps=${(messages.lapMesgs ?? []).length}`);
  for (const b of blocks as any[]) {
    console.log(`  [warmUp block] ${Math.round(b.duration ?? 0)}s  start=${b.startTime instanceof Date ? b.startTime.toISOString() : b.startTime}`);
  }
  console.log();

  // Per-exercise rollup from the normalized workout.
  interface Row { count: number; cat: string; fitName: string; guessed: boolean; kg: number[]; dur: number[] }
  const rows = new Map<string, Row>();
  for (const s of wo.sets) {
    const fit = movements.fitFor(s.movementId, s.description);
    const key = s.exerciseName;
    const r = rows.get(key) ?? {
      count: 0,
      cat: s.fitCategory ?? 'UNKNOWN',
      fitName: fit?.exerciseName ?? '-',
      guessed: fit?.guessed === true,
      kg: [],
      dur: [],
    };
    r.count++;
    r.kg.push(Math.round(s.weightKg * 10) / 10);
    r.dur.push(Math.round(s.durationSec));
    rows.set(key, r);
  }

  const lbl = (a: number[]) => `${Math.min(...a)}-${Math.max(...a)}`;
  console.log('count  TonalName -> fitCategory / fitName  | kg(min-max)  dur(min-max)s');
  for (const [name, r] of [...rows.entries()].sort()) {
    const flag = r.cat === 'UNKNOWN' ? '  <-- UNKNOWN' : r.guessed ? '  <-- GUESSED' : '';
    console.log(
      `${String(r.count).padStart(3)}x  ${name} -> ${r.cat} / ${r.fitName} | kg ${lbl(r.kg)}  dur ${lbl(r.dur)}s${flag}`,
    );
  }

  const unknown = [...rows.values()].filter((r) => r.cat === 'UNKNOWN').length;
  const guessed = [...rows.values()].filter((r) => r.guessed).length;
  console.log(`\n${rows.size} distinct exercises, ${unknown} UNKNOWN, ${guessed} GUESSED (unmapped, keyword fallback)`);
}

main().catch((err) => {
  console.error('inspect-fit failed:', err);
  process.exit(1);
});
