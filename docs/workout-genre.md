# Workout genre (Aero, Pilates, Yoga, ...)

## What it's for

Every Tonal workout syncs as a FIT activity with a `sport`/`subSport` — the
field Garmin Connect uses to decide how to display it and how to compute
things like calories and training effect. This project defaults to
`training`/`strengthTraining`, which is right for most Tonal workouts, but not
for Aero, Pilates, Yoga, Mobility, Meditation, Recovery, or Warm-up sessions.

Tonal gives no reliable field to tell these apart — `workoutType` in Tonal's
own data is only ever `"Custom"` or `"Linear"`, regardless of what the workout
actually is. So this is inferred, not looked up.

## How it's inferred

Two passes, in order — see [`src/genre.ts`](../src/genre.ts):

1. **Workout name.** A keyword match against the workout's name: `aero` ->
   Aero, `pilates` -> Pilates, `yoga` -> Yoga, `mobility` -> Mobility,
   `meditat` -> Meditation, `warm[ ]?up` -> Warm-up, `recover` -> Recovery.
2. **Fallback, only if the name matches nothing:** the fraction of the
   workout's *sets* that landed in a cardio-machine FIT exercise category
   (`bike`, `elliptical`, `indoorRow`, ...) or FIT's dedicated `pose` category.
   40%+ cardio-category sets -> Aero; 40%+ `pose`-category sets -> Yoga.
   Everything else defaults to **strength**.

The fallback only covers Aero and Yoga on purpose. Those are the only genres
with a real structural signal in Tonal's per-set data — cardio-machine
categories and the yoga-specific `pose` category both exist in FIT's exercise
vocabulary. Pilates, Mobility, Meditation, Recovery, and Warm-up movements
don't cluster into any distinctive category (a Pilates workout's movements
mostly show up "Unknown" in the exercise map for the same reason — see
[movement-map.md](movement-map.md)), so there's nothing to detect them from.
**If you want those classified correctly, put the keyword in the workout
name.** Strength stays the safe default when nothing matches, rather than
guessing.

The classification and its reason are logged every sync:

```
[sync] genre: aero -> training/cardioTraining (matched "aero" in workout name)
```

`npm run inspect:fit` prints the same line without uploading anything.

## FIT sport/subSport by genre

| Genre | `sport` | `subSport` |
| --- | --- | --- |
| Strength (default) | `training` | `strengthTraining` |
| Aero | `training` | `cardioTraining` |
| Pilates | `training` | `pilates` |
| Yoga | `training` | `yoga` |
| Mobility | `mobility` | `generic` |
| Meditation | `meditation` | `generic` |
| Warm-up | `training` | `warmUp` |
| Recovery | `training` | `flexibilityTraining` (closest available — FIT has no dedicated "recovery" type) |

## Calories

Only **strength** workouts send an explicit `totalCalories` (Tonal's figure,
with `TONAL_CALORIE_FACTOR` applied if you've set one — see `.env.example`).
Every other genre sends heart-rate records and avg/max HR, but no calorie
figure at all: Garmin Connect computes calories itself from HR + your profile
for cardio/yoga/etc. activity types, which is a better number than anything
this service could derive from Tonal's side for a workout style Tonal's own
app doesn't score the same way it scores strength.

## Overriding a bad guess

There's no config for this yet — if a workout gets misclassified, the fix is
to put the right keyword in the workout's name in Tonal before it syncs.
Already-synced activities don't change retroactively; see
[force a re-sync](troubleshooting.md#force-a-re-sync) to redo one.
