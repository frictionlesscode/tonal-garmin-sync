import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

/**
 * Lower bound on the polling interval. Tonal has no public API — this service
 * uses the same private endpoints the mobile app does. Polling harder than this
 * risks the endpoint being rate-limited or blocked for everyone, and buys almost
 * nothing: a workout takes a moment to finalize server-side either way.
 */
export const MIN_POLL_MINUTES = 15;

export interface Config {
  tonalEmail: string;
  tonalPassword: string;
  /** Optional — Garmin auth uses pre-minted OAuth tokens, not password login. */
  garminEmail?: string;
  webhookSecret: string;
  port: number;
  dataDir: string;
  /** Unit Tonal reports actual weights in. "lb" (default) or "kg". */
  tonalWeightUnit: 'lb' | 'kg';
  /** Unit Garmin Connect should *display* loads in. Storage is always kg (FIT spec). */
  garminDisplayUnit: 'lb' | 'kg';
  /** Minutes between automatic sync checks; 0 disables polling (webhook only). */
  pollIntervalMinutes: number;
  /** How many recent activities a poll examines (catches back-to-back workouts). */
  pollLookback: number;
  /**
   * Multiplier applied to Tonal's reported calories before upload. 1 (default)
   * sends Tonal's figure unmodified. Not derived from anything Tonal or Garmin
   * publishes — set this only if you have your own reason to trust a different
   * figure than Tonal's.
   */
  calorieFactor: number;
}

function unit(name: string, fallback: 'lb' | 'kg'): 'lb' | 'kg' {
  const v = optional(name, fallback).toLowerCase();
  if (v !== 'lb' && v !== 'kg') {
    throw new Error(`${name} must be "lb" or "kg", got "${v}"`);
  }
  return v;
}

function integer(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a whole number, got "${raw}"`);
  }
  return n;
}

function positiveFloat(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return n;
}

export function loadConfig(): Config {
  // Polling is opt-in. Below the floor we clamp and warn rather than throw, so a
  // stray value can't stop an otherwise-working install from booting.
  let pollIntervalMinutes = integer('POLL_INTERVAL_MINUTES', 0);
  if (pollIntervalMinutes > 0 && pollIntervalMinutes < MIN_POLL_MINUTES) {
    console.warn(
      `[config] POLL_INTERVAL_MINUTES=${pollIntervalMinutes} is below the ${MIN_POLL_MINUTES}-minute ` +
        `minimum; using ${MIN_POLL_MINUTES}. See docs/iphone.md for why.`,
    );
    pollIntervalMinutes = MIN_POLL_MINUTES;
  }

  return {
    tonalEmail: required('TONAL_EMAIL'),
    tonalPassword: required('TONAL_PASSWORD'),
    garminEmail: process.env.GARMIN_EMAIL,
    webhookSecret: required('WEBHOOK_SECRET'),
    port: integer('PORT', 8080),
    dataDir: optional('DATA_DIR', '/data'),
    tonalWeightUnit: unit('TONAL_WEIGHT_UNIT', 'lb'),
    garminDisplayUnit: unit('GARMIN_DISPLAY_UNIT', 'kg'),
    pollIntervalMinutes,
    pollLookback: Math.max(1, integer('POLL_LOOKBACK', 3)),
    calorieFactor: positiveFloat('TONAL_CALORIE_FACTOR', 1),
  };
}
