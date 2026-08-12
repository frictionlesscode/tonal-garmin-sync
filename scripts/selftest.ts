/**
 * Offline self-test.
 *
 *   npm run selftest
 *
 * Runs with no network and no credentials, so CI can execute it. It covers the
 * activity-feed edge cases that only appear on *some* accounts — the kind of
 * thing that otherwise gets found by a user rather than by us:
 *
 *  - Activities imported from Apple Health ("External"), and deleted ones, are
 *    filtered out before anything tries to fetch per-set detail for them.
 *  - One activity failing with a 404 mid-batch does not abandon the workouts
 *    after it.
 *  - A 404 is not mistaken for an expired session, which would otherwise force
 *    a pointless re-login for every skipped activity.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Tonal, isSyncable, isAuthFailure, isHttpStatus } from '../src/tonal.js';
import { SyncService } from '../src/sync.js';
import type { SyncResult } from '../src/sync.js';
import { classifyGenre } from '../src/genre.js';
import { normalizeWorkout } from '../src/fit.js';
import { Movements } from '../src/movements.js';
import type { NormalizedSet } from '../src/types.js';

let failures = 0;
const check = (label: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const err404 = Object.assign(new Error('HTTP 404'), { name: 'TonalClientError', statusCode: 404 });
const errAuth = new Error('Token expired and refresh failed. Call authenticate() first.');

console.log('\n== issue #2: unsyncable activities are filtered out ==');
check('internal activity is syncable', isSyncable({ activityType: 'Internal' }));
check('external activity is NOT syncable', !isSyncable({ activityType: 'External' }));
check('deleted activity is NOT syncable', !isSyncable({ deletedAt: '2026-01-01T00:00:00Z' }));
check('missing activityType is treated as syncable', isSyncable({ name: 'x' }));

console.log('\n== workout genre classification ==');
const setWith = (fitCategory: string | undefined): NormalizedSet => ({
  index: 0, exerciseName: 'x', reps: 5, weightKg: 10, startTime: new Date(), durationSec: 30, fitCategory,
});
check('name match wins over set composition', classifyGenre('Aero 3.0', [setWith('benchPress')]).genre === 'aero');
check('pilates name match', classifyGenre('Pilates Flow', []).genre === 'pilates');
check('yoga name match', classifyGenre('Morning Yoga', []).genre === 'yoga');
check('strength name has no keyword, falls to default', classifyGenre('Psmf Friday Pull', [setWith('benchPress')]).genre === 'strength');
check(
  'cardio-heavy sets fall back to aero when unnamed',
  classifyGenre('Workout 42', [setWith('bike'), setWith('bike'), setWith('elliptical'), setWith('squat')]).genre === 'aero',
);
check(
  'pose-heavy sets fall back to yoga when unnamed',
  classifyGenre('Workout 42', [setWith('pose'), setWith('pose'), setWith('pose'), setWith('squat')]).genre === 'yoga',
);
check(
  'a couple cardio sets in an otherwise-strength workout stay strength',
  classifyGenre('Workout 42', [setWith('bike'), setWith('squat'), setWith('squat'), setWith('benchPress')]).genre === 'strength',
);
console.log('\n== calorie fallback when Tonal recorded no HR ==');
const fakeMovements = new Movements(Object.create(Tonal.prototype) as Tonal, path.join(os.tmpdir(), 'tgs-genre-test'));
const baseSummary = { id: 'w1', name: 'Aero Test', timestamp: '2026-01-01T00:00:00Z' };
const detailWithHr = {
  name: 'Aero Test',
  workoutSetActivity: [],
  calories: [{ algorithm: 'Tonal', caloriesBurned: 300 }],
  beginTime: '2026-01-01T00:00:00Z',
  endTime: '2026-01-01T00:10:00Z',
  workoutHeartRate: { workoutHeartRateValues: [{ timestamp: '2026-01-01T00:05:00Z', heartRate: 120 }] },
};
const detailNoHr = { ...detailWithHr, workoutHeartRate: undefined };
const woAeroWithHr = normalizeWorkout(baseSummary, detailWithHr as any, fakeMovements, 'lb', 0.7);
const woAeroNoHr = normalizeWorkout(baseSummary, detailNoHr as any, fakeMovements, 'lb', 0.7);
const woStrength = normalizeWorkout({ ...baseSummary, name: 'Leg Day' }, { ...detailWithHr, name: 'Leg Day' } as any, fakeMovements, 'lb', 0.7);
check('non-strength with HR recorded: no calories sent', woAeroWithHr.sendCalories === false);
check('non-strength with NO HR recorded: falls back to sending calories', woAeroNoHr.sendCalories === true);
check('the fallback sends Tonal\'s raw figure, not calorieFactor-discounted', woAeroNoHr.calorieToSend === 300);
check('strength always sends calories, discounted by calorieFactor', woStrength.sendCalories === true && woStrength.calorieToSend === 210);

console.log('\n== weight doubling for both-arms-simultaneous movements ==');
// baseWeight is per-arm; Tonal's own totalVolume field confirms the real
// combined load is 2x baseWeight when both arms pull at once (see fit.ts).
const doublingMovements = new Movements(Object.create(Tonal.prototype) as Tonal, path.join(os.tmpdir(), 'tgs-weight-test'));
(doublingMovements as unknown as { armsSameTime: Record<string, boolean> }).armsSameTime = { m1: true, m2: false };
check('doublesWeight true for a both-arms movement', doublingMovements.doublesWeight('m1') === true);
check('doublesWeight false for a single-arm movement', doublingMovements.doublesWeight('m2') === false);
check('doublesWeight false for an unknown movement', doublingMovements.doublesWeight('unknown') === false);

const LB_TO_KG = 0.45359237;
const detailDoubling = {
  name: 'Leg Day',
  workoutSetActivity: [
    { movementId: 'm1', repCount: 8, baseWeight: 21 }, // both-arms: true combined load is 42
    { movementId: 'm2', repCount: 10, baseWeight: 56 }, // single-arm: 56 already is the total
  ],
  beginTime: '2026-01-01T00:00:00Z',
  endTime: '2026-01-01T00:10:00Z',
};
const woDoubling = normalizeWorkout(
  { id: 'w2', name: 'Leg Day', timestamp: '2026-01-01T00:00:00Z' },
  detailDoubling as any,
  doublingMovements,
  'lb',
  1,
);
const closeEnough = (a: number, b: number) => Math.abs(a - b) < 0.01;
check(
  'both-arms set weight is doubled before unit conversion',
  closeEnough(woDoubling.sets[0].weightKg, 42 * LB_TO_KG),
  `got ${woDoubling.sets[0].weightKg}`,
);
check(
  'single-arm set weight is sent as-is',
  closeEnough(woDoubling.sets[1].weightKg, 56 * LB_TO_KG),
  `got ${woDoubling.sets[1].weightKg}`,
);

// Real Tonal instance with only the network call stubbed out.
const tonal = Object.create(Tonal.prototype) as Tonal;
const feed = [
  { id: 'a', name: 'Real 1', completed: true, activityType: 'Internal', timestamp: '2026-01-01T10:00:00Z' },
  { id: 'b', name: 'Apple Health Run', completed: true, activityType: 'External', workoutId: null, timestamp: '2026-01-02T10:00:00Z' },
  { id: 'c', name: 'Real 2 (404s)', completed: true, activityType: 'Internal', timestamp: '2026-01-03T10:00:00Z' },
  { id: 'd', name: 'Deleted', completed: true, activityType: 'Internal', deletedAt: '2026-01-04T00:00:00Z', timestamp: '2026-01-04T10:00:00Z' },
  { id: 'e', name: 'Real 3', completed: true, activityType: 'Internal', timestamp: '2026-01-05T10:00:00Z' },
];
(tonal as unknown as Record<string, unknown>).getActivitySummaries = async () => feed;

const picked = await tonal.getRecentCompletedActivities(10);
check(
  'external + deleted excluded, real workouts kept in order',
  JSON.stringify(picked.map((s) => s.id)) === '["a","c","e"]',
  `got ${JSON.stringify(picked.map((s) => s.id))}`,
);

console.log('\n== error classification ==');
check('404 is not an auth failure', !isAuthFailure(err404));
check('expired-token message is an auth failure', isAuthFailure(errAuth));
check('401 is an auth failure', isAuthFailure(Object.assign(new Error('x'), { statusCode: 401 })));
check('isHttpStatus detects 404', isHttpStatus(err404, 404));

console.log('\n== issue #1: a 404 mid-batch does not abandon the rest ==');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgs-test-'));
const service = new SyncService({
  tonalEmail: 'x', tonalPassword: 'x', webhookSecret: 'x', port: 0, dataDir: dir,
  tonalWeightUnit: 'lb', garminDisplayUnit: 'kg', pollIntervalMinutes: 0, pollLookback: 3,
  calorieFactor: 1,
});
await service.init();

// Inject stubs so no network is touched; dryRun keeps Garmin out of it entirely.
const priv = service as unknown as Record<string, unknown>;
priv.tonal = Object.assign(Object.create(Tonal.prototype), {
  getActivitySummaries: async () => feed,
  getWorkoutDetail: async (id: string) => {
    if (id === 'c') throw err404; // the middle real workout fails
    return { name: `detail-${id}`, workoutSetActivity: [{ movementId: 'm1', repCount: 5, baseWeight: 100 }] };
  },
});
priv.movements = {
  nameFor: () => 'Exercise',
  fitFor: () => undefined,
  doublesWeight: () => false,
  load: async () => {},
};

const results: SyncResult[] = await service.runSyncRecent(10, { dryRun: true });
const byId = Object.fromEntries(results.map((r) => [r.activityId, r.status]));
check('all three real workouts produced a result', results.length === 3, `got ${results.length}`);
check('workout before the 404 still processed', byId.a === 'would-sync', `a=${byId.a}`);
check('the 404 workout is recorded as failed', byId.c === 'failed', `c=${byId.c}`);
check('workout AFTER the 404 still processed', byId.e === 'would-sync', `e=${byId.e}`);
check(
  'failure carries a human-readable reason',
  (results.find((r) => r.activityId === 'c')?.error ?? '').includes('no per-set detail'),
);

await fs.rm(dir, { recursive: true, force: true });

console.log('\n== an expired session is retried, not lost ==');
const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'tgs-test-'));
const svc = new SyncService({
  tonalEmail: 'x', tonalPassword: 'x', webhookSecret: 'x', port: 0, dataDir: dir2,
  tonalWeightUnit: 'lb', garminDisplayUnit: 'kg', pollIntervalMinutes: 0, pollLookback: 3,
});
await svc.init();

// ts-tonal-client keeps using a bearer token ~14h past its real expiry, so a
// call can 401 even though the client believes it is logged in.
const err401 = Object.assign(new Error('HTTP 401: token is expired by 10m0s'), { statusCode: 401 });
let sessionDead = true;
let logins = 0;
const client = Object.assign(Object.create(Tonal.prototype), {
  getActivitySummaries: async () => feed,
  getWorkoutDetail: async (id: string) => {
    if (sessionDead) throw err401;
    return { name: `detail-${id}`, workoutSetActivity: [{ movementId: 'm1', repCount: 5, baseWeight: 100 }] };
  },
});
const movementsStub = {
  nameFor: () => 'Exercise',
  fitFor: () => undefined,
  doublesWeight: () => false,
  load: async () => {},
};
const stubs = svc as unknown as Record<string, unknown>;
// Stand in for a real login. dropTonalClient() clears both the client and the
// movement cache that references it, so restore both — same as ensureConnected.
stubs.ensureConnected = async () => {
  logins++;
  if (logins > 1) sessionDead = false;
  stubs.tonal = client;
  stubs.movements = movementsStub;
};
await (stubs.ensureConnected as () => Promise<void>)();
logins = 0;
sessionDead = true;

const retried = await svc.runSyncRecent(1, { dryRun: true });
check('workout still syncs despite the stale token', retried[0]?.status === 'would-sync', `got ${retried[0]?.status}`);
check('the retry re-authenticated', logins === 2, `logins=${logins}`);
await fs.rm(dir2, { recursive: true, force: true });

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
