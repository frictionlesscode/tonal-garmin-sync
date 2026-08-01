/**
 * Inspect what heart-rate and calorie data Tonal has for your most recent
 * completed activity — at the summary level, the detail level, and as a
 * time-series. Read-only; nothing is uploaded.
 *
 *   npm run check:hr
 *
 * Tonal only records heart rate if you pair an HR monitor to the Tonal itself.
 * If the sample count is 0, that's why, and Garmin will show no HR graph.
 *
 * PRIVACY: this prints your own heart-rate samples and calorie figures. Redact
 * before pasting anywhere public — see CONTRIBUTING.md.
 */
import 'dotenv/config';
import { Tonal, activityIdOf } from '../src/tonal.js';

const HR_RE = /heart|hr\b|bpm|calorie|cardio|biometric/i;

function findKeys(obj: unknown, path = '', hits: string[] = [], depth = 0): string[] {
  if (depth > 6 || obj == null || typeof obj !== 'object') return hits;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (HR_RE.test(k)) {
      const preview = Array.isArray(v) ? `[array len ${v.length}]` : JSON.stringify(v);
      hits.push(`${p} = ${preview?.slice(0, 120)}`);
    }
    if (typeof v === 'object') findKeys(v, p, hits, depth + 1);
  }
  return hits;
}

async function main() {
  const tonal = await Tonal.connect(process.env.TONAL_EMAIL!, process.env.TONAL_PASSWORD!);
  const summary = await tonal.getLatestCompletedActivity();
  if (!summary) return console.log('no completed activity');

  console.log('=== summary: HR/calorie-ish keys ===');
  console.log(findKeys(summary).join('\n') || '(none)');
  console.log('\nsummary top-level keys:', Object.keys(summary).join(', '));

  const id = activityIdOf(summary);
  const detail = await tonal.getWorkoutDetail(id) as any;

  console.log('\n=== HR series structure ===');
  const hr = detail.workoutHeartRate;
  console.log('workoutHeartRate keys:', hr ? Object.keys(hr).join(', ') : '(none)');
  const vals = hr?.workoutHeartRateValues;
  console.log('sample count:', Array.isArray(vals) ? vals.length : 'n/a');
  if (Array.isArray(vals) && vals.length) {
    console.log('first sample:', JSON.stringify(vals[0]));
    console.log('2nd sample:', JSON.stringify(vals[1]));
    console.log('last sample:', JSON.stringify(vals[vals.length - 1]));
  }
  console.log('\n=== timing & calories ===');
  console.log('beginTime:', detail.beginTime, ' endTime:', detail.endTime);
  console.log('activeDuration:', detail.activeDuration, ' totalDuration:', detail.totalDuration);
  console.log('calories:', JSON.stringify(detail.calories));
}

main().catch((e) => {
  console.error('check-hr failed:', e);
  process.exit(1);
});
