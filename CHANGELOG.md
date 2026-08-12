# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Workout genre classification: Aero, Pilates, Yoga, Mobility, Meditation,
  Warm-up, and Recovery workouts are now detected (by name keyword, falling
  back to per-set exercise-category signal for Aero/Yoga) and synced with the
  correct FIT `sport`/`subSport` instead of defaulting every workout to
  strength training. See [docs/workout-genre.md](docs/workout-genre.md).
  - Non-strength genres now send heart-rate records without an explicit
    calorie figure, letting Garmin Connect compute calories from HR the way
    it does for cardio/yoga activities, rather than applying the
    strength-workout calorie path to a session it doesn't fit.
  - Classification and its reason are logged on every sync
    (`[sync] genre: ...`) and printed by `npm run inspect:fit`.

## Earlier history

This project began as [theengineer1676/tonal-garmin-sync](https://github.com/theengineer1676/tonal-garmin-sync),
which built the core sync engine this project still runs on: the webhook
trigger, FIT encoding of sets/reps/weight/HR, duplicate-free upload, the
291-exercise movement name map, weight-doubling for both-arms-simultaneous
movements, ruck load parsing, weather/temperature capture, the Tonal
calorie-fallback logic, recovery from a stale Tonal session, and a dependency
CVE fix. See that repository's history for the detailed log of that work.
