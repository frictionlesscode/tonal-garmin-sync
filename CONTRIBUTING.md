# Contributing

Contributions are welcome, especially movement-map additions.

## Before you paste anything public

The diagnostic scripts print **your own workout data**. Please redact before
putting output in an issue or PR:

| Script | What it prints that's yours |
| --- | --- |
| `npm run verify` | One real set: movement id, reps, weight, timestamps |
| `npm run check:hr` | Heart-rate samples, calories, workout timing |
| `npm run inspect:fit` | Workout name, every exercise, weight ranges |
| container logs | Workout names and activity ids |

Replace weights, reps and workout names with placeholders. **Keep** field
*names*, movement UUIDs, error text and status codes — those are what actually
help diagnose a problem. Never paste `.env` contents, anything from
`data/garmin-tokens/`, or your webhook secret.

## Adding movements to the map

This is the most useful thing you can contribute. The bundled map covers 291
movements — one person's programs — so there are certainly gaps.

1. Find what's missing: `npm run inspect:fit` flags anything `UNKNOWN`.
2. Add a row to [`config/curated.json`](config/curated.json):

   ```json
   {
     "movementId": "the-uuid-from-tonal",
     "name": "Tonal's name for it",
     "exerciseName": "aValidFitExerciseName",
     "categoryHint": "benchPress",
     "onMachine": true
   }
   ```

   `exerciseName` must be a real FIT name — check
   [`config/fit-exercises.json`](config/fit-exercises.json). Set
   `onMachine: false` for bodyweight movements, which log a weight of 0.

3. Rebuild and check: `npm run build:curated -- --out config/movement-map.json`
   then `npm run inspect:fit`.
4. Open a PR with both files changed.

Movement UUIDs are global to Tonal's catalog, not per-account, so a mapping that
works for you works for everyone. See [docs/movement-map.md](docs/movement-map.md).

## Code changes

```bash
npm install
npm run typecheck        # must pass
npm run selftest         # must pass — no network or credentials needed
docker compose build     # must succeed
```

`npm run selftest` covers the activity-feed edge cases that only exist on some
accounts (Apple Health imports, deleted activities, a 404 partway through a
batch). If you fix a bug that depended on account-specific data, adding a case
there is the best way to keep it fixed.

Beyond that there's no full test suite — the project is mostly I/O against two
APIs that can't be reached from CI. So also verify by hand, and say what you did:

- `npm run inspect:fit` builds and decodes a real FIT file without uploading.
  That's the safest way to check anything touching `fit.ts` or `movements.ts`.
- `npm run backfill -- 3 --dry` exercises the whole path except the upload.

Please keep changes focused, and match the surrounding style: comments explain
*why*, not *what*.

## Things to know before proposing a redesign

A few decisions look odd but are deliberate. Please read
[README.md](README.md#limitations-and-risks) first, and the comments in the
relevant file:

- **Reaching into `ts-tonal-client`'s private HTTP client** (`src/tonal.ts`) —
  the only way to get per-set data. Isolated to one method on purpose.
- **Shelling out to Python for the Garmin upload** (`src/garmin.ts`) — the Node
  Garmin libraries can't get through Garmin's WAF/MFA. This isn't accidental.
- **JSON file instead of a database** (`src/store.ts`) — the dataset is a few
  hundred ids; SQLite would add a native build toolchain to the image.
- **`weight` is `baseWeight` as-is** (`src/fit.ts`) — Tonal already reports it
  correctly per attachment. Don't "fix" it by doubling for two-handed moves.

## Reporting a bug

Include: what you expected, what happened, the relevant log lines (redacted),
your platform (Docker/bare, Android/iPhone/polling), and whether
`npm run verify` succeeds. If Tonal changed its API, `npm run verify` output
showing the new field names is exactly what's needed.
