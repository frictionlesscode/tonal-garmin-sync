import { Encoder, Profile } from '@garmin/fitsdk';
import type { Movements } from './movements.js';
import type {
  NormalizedSet,
  NormalizedWorkout,
  TonalActivitySummaryLoose,
  TonalSetActivityLoose,
  TonalWorkoutDetailLoose,
} from './types.js';
import { activityIdOf } from './tonal.js';

const LB_TO_KG = 0.45359237;

function toKg(value: number, unit: 'lb' | 'kg'): number {
  return unit === 'kg' ? value : value * LB_TO_KG;
}

function firstNumber(...vals: Array<number | undefined>): number {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

function setArray(detail: TonalWorkoutDetailLoose): TonalSetActivityLoose[] {
  return detail.workoutSetActivity ?? detail.sets ?? detail.setActivities ?? [];
}

/**
 * Turn the (loosely-typed) Tonal detail + summary into a clean, FIT-ready
 * workout. Tonal does not appear to give per-set timestamps, so we lay the sets
 * out sequentially across the workout's start..duration window with an even
 * estimated duration each. Reps/weights come straight from the detail.
 */
export function normalizeWorkout(
  summary: TonalActivitySummaryLoose,
  detail: TonalWorkoutDetailLoose,
  movements: Movements,
  weightUnit: 'lb' | 'kg',
): NormalizedWorkout {
  const activityId = activityIdOf(summary);
  const name = String(detail.name ?? summary.name ?? 'Tonal Workout');

  const rawSets = setArray(detail);

  // Fallback per-set length only used when a set has no real Tonal timing.
  const startIso = detail.startTime ?? detail.timestamp ?? summary.timestamp ?? summary.localTimestamp;
  const workoutStartFallback = startIso ? new Date(startIso) : new Date();
  const fallbackPerSetSec =
    rawSets.length > 0
      ? firstNumber(detail.duration, summary.duration, rawSets.length * 45) / rawSets.length
      : 45;

  let cursor = workoutStartFallback.getTime();
  const sets: NormalizedSet[] = rawSets.map((s, i) => {
    const movementId = s.movementId ? String(s.movementId) : undefined;
    const fit = movements.fitFor(movementId);
    const reps = Math.round(firstNumber(s.repCount, s.repetition, s.prescribedReps));

    // Weight: send Tonal's nominal set weight (baseWeight) as-is — Tonal already
    // reports it correctly per attachment (handles = per-hand, barbell = combined,
    // single-cable rope = that cable). Bodyweight movements log 0.
    let weightRaw = firstNumber(s.baseWeight, s.avgWeight);
    if (fit && fit.onMachine === false) weightRaw = 0;

    // Real per-set timing from Tonal: beginTime/endTime, or the duration field
    // (= time under tension). Fall back to a synthesized slot only if missing.
    const begin = s.beginTime ? new Date(s.beginTime).getTime() : undefined;
    const end = s.endTime ? new Date(s.endTime).getTime() : undefined;
    const durationSec =
      firstNumber(s.duration) ||
      (begin !== undefined && end !== undefined ? (end - begin) / 1000 : 0) ||
      fallbackPerSetSec;
    const startMs = begin ?? cursor;
    cursor = (end ?? startMs + durationSec * 1000) + 1; // next set starts after this one

    return {
      index: i,
      exerciseName: movements.nameFor(movementId),
      movementId,
      reps,
      weightKg: toKg(weightRaw, weightUnit),
      startTime: new Date(startMs),
      durationSec,
      fitCategory: fit?.category ?? undefined,
      fitSubtype: fit?.subtype ?? undefined,
    };
  });

  // Heart-rate time series (chronological) + aggregates, if Tonal recorded them.
  const hrSamples = (detail.workoutHeartRate?.workoutHeartRateValues ?? [])
    .filter((v) => v.timestamp && typeof v.heartRate === 'number')
    .map((v) => ({ time: new Date(v.timestamp as string), bpm: v.heartRate as number }))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  const avgHr = detail.workoutHeartRate?.avgHeartRate;
  const maxHr = detail.workoutHeartRate?.maxHeartRate;
  const totalCalories = detail.calories?.[0]?.caloriesBurned;

  // Workout window spans Tonal's begin/end, or failing that the sets/HR extents.
  const lastSet = sets[sets.length - 1];
  const lastSetEnd = lastSet ? lastSet.startTime.getTime() + lastSet.durationSec * 1000 : undefined;
  const starts = [
    detail.beginTime ? Date.parse(detail.beginTime) : undefined,
    sets[0]?.startTime.getTime(),
    hrSamples[0]?.time.getTime(),
  ].filter((n): n is number => typeof n === 'number');
  const ends = [
    detail.endTime ? Date.parse(detail.endTime) : undefined,
    lastSetEnd,
    hrSamples[hrSamples.length - 1]?.time.getTime(),
  ].filter((n): n is number => typeof n === 'number');
  const startTime = starts.length ? new Date(Math.min(...starts)) : workoutStartFallback;
  const endTime = ends.length ? new Date(Math.max(...ends)) : startTime;
  const totalDurationSec =
    (endTime.getTime() - startTime.getTime()) / 1000 || firstNumber(summary.duration);

  const totalReps = firstNumber(detail.totalReps, summary.totalReps) || sets.reduce((a, s) => a + s.reps, 0);
  const totalVolumeKg = toKg(firstNumber(detail.totalVolume, summary.totalVolume), weightUnit);

  return {
    activityId, name, startTime, durationSec: totalDurationSec, totalReps, totalVolumeKg, sets,
    hrSamples, avgHr, maxHr, totalCalories,
  };
}

/**
 * Encode a strength-training activity FIT file from a normalized workout.
 * Message order follows the FIT activity-file convention:
 * file_id -> timer start -> set messages -> timer stop -> lap -> session -> activity.
 *
 * `displayUnit` only changes how Garmin Connect *renders* loads. Weights are
 * always stored in kilograms, as the FIT spec requires.
 */
export function encodeFit(workout: NormalizedWorkout, displayUnit: 'lb' | 'kg' = 'kg'): Uint8Array {
  // fit_base_unit enum spellings — "pound"/"kilogram", not "lb"/"kg".
  const weightDisplayUnit = displayUnit === 'lb' ? 'pound' : 'kilogram';
  const encoder = new Encoder();
  const start = workout.startTime;
  const end = new Date(start.getTime() + workout.durationSec * 1000);

  // The SDK's `Mesg` type only declares mesgNum/developerFields; profile field
  // names (type, timestamp, repetitions, ...) are accepted at runtime but not in
  // the type. This helper localizes the one needed cast.
  const write = (mesgNum: number, fields: Record<string, unknown>): void => {
    encoder.onMesg(mesgNum, fields as never);
  };

  write(Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 0,
    timeCreated: start,
    serialNumber: 0x1000,
  });

  write(Profile.MesgNum.EVENT, {
    timestamp: start,
    event: 'timer',
    eventType: 'start',
  });

  // Heart-rate stream: one record per sample. Garmin builds the HR graph,
  // zones, and HR-based training effect/calories from these.
  workout.hrSamples.forEach((h) => {
    write(Profile.MesgNum.RECORD, { timestamp: h.time, heartRate: h.bpm });
  });

  // Warm-up / cool-down detection: Tonal's HR window includes pre-first-set and
  // post-last-set time. Each gap >= 60s becomes a time-based set.
  const firstSetStart = workout.sets.length ? workout.sets[0].startTime : start;
  const lastSetObj = workout.sets[workout.sets.length - 1];
  const lastSetEnd = lastSetObj
    ? new Date(lastSetObj.startTime.getTime() + lastSetObj.durationSec * 1000)
    : end;
  const MIN_BLOCK_MS = 60_000;
  const hasWarm = workout.sets.length > 0 && firstSetStart.getTime() - start.getTime() >= MIN_BLOCK_MS;
  const hasCool = workout.sets.length > 0 && end.getTime() - lastSetEnd.getTime() >= MIN_BLOCK_MS;
  const warmCount = hasWarm ? 1 : 0;

  // FIT has a `warmUp` exercise category but no cool-down one, and set_type is
  // only rest/active — so warm-up and cool-down both use category warmUp as
  // time-based sets (no reps/weight), distinguished by their position.
  const writeBlock = (idx: number, from: Date, to: Date): void => {
    write(Profile.MesgNum.SET, {
      timestamp: to,
      messageIndex: idx,
      setType: 'active',
      startTime: from,
      duration: (to.getTime() - from.getTime()) / 1000,
      category: ['warmUp'],
      wktStepIndex: idx,
    });
  };

  if (hasWarm) writeBlock(0, start, firstSetStart);

  workout.sets.forEach((s) => {
    write(Profile.MesgNum.SET, {
      timestamp: new Date(s.startTime.getTime() + s.durationSec * 1000),
      messageIndex: warmCount + s.index,
      setType: 'active',
      startTime: s.startTime,
      duration: s.durationSec,
      repetitions: s.reps,
      weight: s.weightKg,
      weightDisplayUnit,
      ...(s.fitCategory ? { category: [s.fitCategory] } : {}),
      ...(s.fitSubtype !== undefined ? { categorySubtype: [s.fitSubtype] } : {}),
      wktStepIndex: warmCount + s.index,
    });
  });

  if (hasCool) writeBlock(warmCount + workout.sets.length, lastSetEnd, end);

  write(Profile.MesgNum.EVENT, {
    timestamp: end,
    event: 'timer',
    eventType: 'stopAll',
  });

  // Garmin Connect doesn't recompute calories for imported activities, so we
  // send Tonal's figure explicitly (otherwise calories show as 0).
  const hr = {
    ...(workout.avgHr ? { avgHeartRate: Math.round(workout.avgHr) } : {}),
    ...(workout.maxHr ? { maxHeartRate: Math.round(workout.maxHr) } : {}),
  };
  const cals = workout.totalCalories ? { totalCalories: Math.round(workout.totalCalories) } : {};

  write(Profile.MesgNum.LAP, {
    messageIndex: 0,
    timestamp: end,
    startTime: start,
    totalElapsedTime: workout.durationSec,
    totalTimerTime: workout.durationSec,
    sport: 'training',
    subSport: 'strengthTraining',
    ...hr,
    ...cals,
  });

  write(Profile.MesgNum.SESSION, {
    messageIndex: 0,
    timestamp: end,
    startTime: start,
    totalElapsedTime: workout.durationSec,
    totalTimerTime: workout.durationSec,
    sport: 'training',
    subSport: 'strengthTraining',
    firstLapIndex: 0,
    numLaps: 1,
    ...hr,
    ...cals,
  });

  write(Profile.MesgNum.ACTIVITY, {
    timestamp: end,
    totalTimerTime: workout.durationSec,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  });

  return encoder.close();
}
