import type { NormalizedSet } from './types.js';

export interface GenreResult {
  genre: string;
  sport: string;
  subSport: string;
  /** Why this genre was picked — logged at sync time for transparency. */
  reason: string;
}

/**
 * Keyword -> genre, checked against the workout name (case-insensitive), in
 * order. First match wins.
 */
const NAME_KEYWORDS: Array<{ pattern: RegExp; genre: string }> = [
  { pattern: /aero/, genre: 'aero' },
  { pattern: /pilates/, genre: 'pilates' },
  { pattern: /yoga/, genre: 'yoga' },
  { pattern: /mobility/, genre: 'mobility' },
  { pattern: /meditat/, genre: 'meditation' },
  { pattern: /warm.?up/, genre: 'warmup' },
  { pattern: /recover/, genre: 'recovery' },
];

/** genre -> FIT sport/subSport. See docs/movement-map.md for why each was picked. */
const GENRE_FIT: Record<string, { sport: string; subSport: string }> = {
  strength: { sport: 'training', subSport: 'strengthTraining' },
  aero: { sport: 'training', subSport: 'cardioTraining' },
  pilates: { sport: 'training', subSport: 'pilates' },
  yoga: { sport: 'training', subSport: 'yoga' },
  mobility: { sport: 'mobility', subSport: 'generic' },
  meditation: { sport: 'meditation', subSport: 'generic' },
  warmup: { sport: 'training', subSport: 'warmUp' },
  recovery: { sport: 'training', subSport: 'flexibilityTraining' },
};

/** FIT exercise categories that indicate cardio-machine work, for the fallback classifier. */
const CARDIO_CATEGORIES = new Set([
  'cardio', 'bike', 'bikeOutdoor', 'elliptical', 'indoorBike', 'indoorRow', 'run', 'runIndoor', 'stairStepper',
]);

/** Fraction of sets that must land in a signal category before the fallback commits to it. */
const FALLBACK_THRESHOLD = 0.4;

/**
 * Classify a workout's overall FIT sport/subSport. Strength is the default.
 * (Whether to send an explicit calorie figure is decided in fit.ts, not here —
 * it also depends on whether Tonal actually recorded any HR for this specific
 * workout, which this function has no visibility into.)
 *
 * Tonal exposes no usable genre field (`workoutType` is only ever "Custom" or
 * "Linear" in practice), so this works in two passes:
 *
 * 1. Keyword match against the workout name.
 * 2. Fallback: the fraction of this workout's *sets* whose FIT exercise
 *    category is a cardio-machine category, or the dedicated `pose` (yoga)
 *    category. This only covers Aero and Yoga — those are the only genres
 *    with a real structural signal in Tonal's per-set data. Pilates,
 *    Mobility, Meditation, Recovery, and Warm-up have no such signal (their
 *    movements don't cluster into a distinctive FIT category), so those rely
 *    entirely on the workout being named accordingly.
 */
export function classifyGenre(name: string, sets: NormalizedSet[]): GenreResult {
  const lower = name.toLowerCase();
  const byName = NAME_KEYWORDS.find((k) => k.pattern.test(lower));

  let genre: string;
  let reason: string;

  if (byName) {
    genre = byName.genre;
    reason = `matched "${byName.pattern.source}" in workout name`;
  } else {
    const withCategory = sets.filter((s) => s.fitCategory);
    const cardioFraction = withCategory.length
      ? withCategory.filter((s) => CARDIO_CATEGORIES.has(s.fitCategory as string)).length / withCategory.length
      : 0;
    const poseFraction = withCategory.length
      ? withCategory.filter((s) => s.fitCategory === 'pose').length / withCategory.length
      : 0;

    if (cardioFraction >= FALLBACK_THRESHOLD) {
      genre = 'aero';
      reason = `fallback: ${Math.round(cardioFraction * 100)}% of sets are cardio-category`;
    } else if (poseFraction >= FALLBACK_THRESHOLD) {
      genre = 'yoga';
      reason = `fallback: ${Math.round(poseFraction * 100)}% of sets are pose-category`;
    } else {
      genre = 'strength';
      reason = 'default — no name match, no dominant cardio/pose signal';
    }
  }

  const fit = GENRE_FIT[genre];
  return { genre, sport: fit.sport, subSport: fit.subSport, reason };
}
