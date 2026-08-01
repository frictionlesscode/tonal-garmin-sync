# The movement map

## What it's for

Garmin's FIT format doesn't accept arbitrary exercise names. It has a **fixed
vocabulary** — a set of categories (`benchPress`, `squat`, `row`, …) each
containing a fixed list of exercise names (`barbellBenchPress`,
`alternatingDumbbellChestPress`, …). If an exercise isn't in that vocabulary,
there is no way to label it.

Tonal has its own catalog, keyed by UUID. The movement map is the bridge:

```json
"eb067021-46de-433c-9262-deea70debde2": {
  "name": "Alternating Bench Press",
  "category": "benchPress",
  "exerciseName": "alternatingDumbbellChestPress",
  "subtype": 26,
  "onMachine": true
}
```

| Field | Meaning |
| --- | --- |
| `name` | Tonal's name — for humans reading the file |
| `category` | FIT exercise category |
| `exerciseName` | FIT exercise name within that category |
| `subtype` | The numeric value of that name — what actually goes in the FIT file |
| `onMachine` | `false` for bodyweight movements, which log a weight of 0 |

**A movement with no mapping still syncs** — its reps, weight and timing all
upload correctly. It just shows as "Unknown" instead of a name.

The bundled map covers **291 movements**. Movement UUIDs are global to Tonal's
catalog rather than per-account, so the map works the same for everyone — and an
addition you contribute helps everybody.

## Which map is used

The service looks in two places, in order:

1. **`$DATA_DIR/movement-map.json`** — yours, if you've built one
2. **`config/movement-map.json`** — the bundled map, used otherwise

So you can customise without touching the repo, and `git pull` won't clobber
your work. On startup the log says which one loaded:

```
[movements] loaded 291 FIT mappings from /app/config/movement-map.json
```

If you see this instead, neither was found and every exercise will be "Unknown":

```
[movements] no movement-map.json found in DATA_DIR or config/; exercises will show as Unknown in Garmin
```

## Find what's missing

```bash
docker compose exec tonal-garmin-sync npm run inspect:fit
```

This builds the FIT file for your latest workout, decodes it back, and prints a
per-exercise summary **without uploading anything**:

```
count  TonalName -> fitCategory / fitName  | kg(min-max)  dur(min-max)s
  4x  Barbell Bench Press -> benchPress / barbellBenchPress | kg 43.1-52.2  dur 28-41s
  3x  Split Squat -> UNKNOWN / - | kg 20.4-20.4  dur 33-38s  <-- UNKNOWN

12 distinct exercises, 1 UNKNOWN
```

Anything flagged `UNKNOWN` needs a map entry.

## Add a movement

**1. Get its Tonal UUID.** Dump your account's catalog:

```bash
docker compose exec tonal-garmin-sync npm run dump:catalog
```

That writes `tonal-movements.json` into your data directory. Find the movement
by name and copy its `id`.

**2. Pick a FIT exercise name.** Open
[`config/fit-exercises.json`](../config/fit-exercises.json) — it lists every
valid name, grouped by category. Search it for something close.

You won't always find an exact match. Pick the nearest reasonable one; a
slightly-approximate label beats "Unknown". Names are camelCase and the spelling
must be exact (casing is auto-corrected, but nothing else is).

**3. Add a row** to [`config/curated.json`](../config/curated.json):

```json
{
  "movementId": "paste-the-uuid-here",
  "name": "Split Squat",
  "exerciseName": "splitSquat",
  "categoryHint": "squat",
  "onMachine": true
}
```

- `categoryHint` is a *hint*. The real category is derived from the exercise
  name you chose — FIT requires the category and name to agree, so the name
  wins. The build tells you when it overrode your hint.
- `onMachine: false` for bodyweight movements (they log 0 weight);
  `true` for anything using the Tonal's cables.

**4. Build it:**

```bash
docker compose exec tonal-garmin-sync npm run build:curated
```

That writes `$DATA_DIR/movement-map.json`, which takes priority over the bundled
map. Output looks like:

```
Read  /app/config/curated.json: 292 rows
Wrote /data/movement-map.json: 292 movements

Category derived from the exercise name (differs from categoryHint): 3
  Split Squat: squat -> lunge (splitSquat)
```

If a name isn't valid FIT you'll get:

```
SKIPPED — not a valid FIT exercise name: 1
  Split Squat -> splitSquatt
  (check the spelling against config/fit-exercises.json — see docs/movement-map.md)
```

**5. Check and restart:**

```bash
docker compose exec tonal-garmin-sync npm run inspect:fit
docker compose restart tonal-garmin-sync
```

## Fixing a wrong mapping

Same process — edit the existing row in `config/curated.json` and rebuild. The
common cases:

- **Weight shows as 0** → `onMachine` should be `true`
- **Bodyweight move shows a weight** → `onMachine` should be `false`
- **Wrong-looking exercise in Garmin** → pick a better `exerciseName`

## Contributing your additions back

Movement UUIDs are the same for everyone, so your additions help every user.

```bash
# build into the repo copy rather than your data dir
npm run build:curated -- --out config/movement-map.json
```

Then open a PR with both `config/curated.json` and `config/movement-map.json`.
See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Already-synced workouts don't change retroactively

The mapping is baked into the FIT file at upload time, so fixing the map won't
relabel workouts already in Garmin. To redo one, see
[force a re-sync](troubleshooting.md#force-a-re-sync).
