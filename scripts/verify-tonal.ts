/**
 * Check that this service can read your Tonal account.
 *
 *   npm run verify
 *
 * Run this first: it's the quickest confirmation that your Tonal credentials
 * work and that the API still returns the shape this project expects. It
 * authenticates, lists your activity summaries, picks the newest completed one,
 * fetches the raw per-set detail, and prints the structural facts the sync
 * depends on:
 *   - which id field on the summary maps to the detail endpoint
 *   - the name of the set array (workoutSetActivity / sets / setActivities)
 *   - the per-set field names for reps and weight, and a sample
 *
 * Nothing is uploaded to Garmin and no state is written.
 *
 * If Tonal changes something, the field names printed here won't match
 * src/types.ts — that's the signal to adjust types.ts, fit.ts (normalizeWorkout)
 * and tonal.ts (activityIdOf). Please open an issue if you hit that.
 *
 * PRIVACY: the output includes one real set from your most recent workout
 * (movement id, reps, weight, timestamps). Redact it before pasting anywhere
 * public — see CONTRIBUTING.md.
 */
import 'dotenv/config';
import { Tonal, activityIdOf } from '../src/tonal.js';

function keys(obj: unknown): string[] {
  return obj && typeof obj === 'object' ? Object.keys(obj as object) : [];
}

async function main() {
  const email = process.env.TONAL_EMAIL;
  const password = process.env.TONAL_PASSWORD;
  if (!email || !password) {
    throw new Error('Set TONAL_EMAIL and TONAL_PASSWORD in env / .env');
  }

  console.log('Connecting to Tonal...');
  const tonal = await Tonal.connect(email, password);

  const summaries = await tonal.getActivitySummaries();
  console.log(`\nFound ${summaries.length} activity summaries.`);
  if (summaries.length === 0) return;

  const summary = (await tonal.getLatestCompletedActivity()) ?? summaries[0];
  console.log('\n--- Newest completed summary ---');
  console.log('summary keys:', keys(summary).join(', '));
  console.log('candidate ids:', {
    id: summary.id,
    workoutActivityId: summary.workoutActivityId,
    workoutId: summary.workoutId,
  });

  const activityId = activityIdOf(summary);
  console.log(`\nFetching detail for activityId=${activityId} ...`);
  const detail = await tonal.getWorkoutDetail(activityId);

  console.log('\n--- Detail ---');
  console.log('detail keys:', keys(detail).join(', '));

  const setArrayName =
    (Array.isArray(detail.workoutSetActivity) && 'workoutSetActivity') ||
    (Array.isArray(detail.sets) && 'sets') ||
    (Array.isArray((detail as Record<string, unknown>).setActivities) && 'setActivities') ||
    '(none found)';
  console.log('set array field:', setArrayName);

  const sets = detail.workoutSetActivity ?? detail.sets ?? [];
  console.log('set count:', sets.length);
  if (sets.length > 0) {
    console.log('\nfirst set keys:', keys(sets[0]).join(', '));
    console.log('first set sample:', JSON.stringify(sets[0], null, 2));
    console.log('\nReps fields present:', {
      repCount: sets[0].repCount,
      repetition: sets[0].repetition,
      prescribedReps: sets[0].prescribedReps,
    });
    console.log('Weight fields present:', {
      avgWeight: sets[0].avgWeight,
      baseWeight: sets[0].baseWeight,
    });
  }

  console.log('\nDone. Confirm the field names above match src/types.ts.');
  console.log('NOTE: the sample set above is your own workout data — redact it before sharing.');
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exit(1);
});
