# Getting Tonal access

**Short version:** there is nothing to sign up for. You put your normal Tonal
email and password in `.env` and that's it. The rest of this page explains what
that actually means, because you should know before you do it.

## There is no Tonal API

Tonal publishes no public API, no developer program, no OAuth, no personal
access tokens, and no app passwords. There is no supported way for another
program to read your workouts.

So this service does what every other Tonal integration does: it signs in with
your email and password against the same private endpoints the Tonal mobile app
uses, via the [`@dlwiest/ts-tonal-client`](https://www.npmjs.com/package/@dlwiest/ts-tonal-client)
library.

Three consequences worth understanding:

1. **Your Tonal password sits in a file in plaintext.** Anyone who can read
   `.env` has full access to your Tonal account. There is no way around this —
   Tonal offers no token you could use instead. See [SECURITY.md](../SECURITY.md).
2. **Tonal has not blessed this and could break it at any time.** A login change
   or an endpoint change would stop the sync. Nothing is guaranteed.
3. **It may conflict with Tonal's terms of service.** You are using your own
   account to read your own workout data, which is the mildest possible version
   of this, but you should make that call yourself.

If any of that is unacceptable, this is the point to stop — everything else
depends on it.

**A reasonable precaution:** make your Tonal password unique to Tonal. If the
file ever leaks, the damage stops there.

## Setting it up

Put your normal Tonal login into `.env`:

```bash
TONAL_EMAIL=you@example.com
TONAL_PASSWORD=your-tonal-password
```

Then restrict the file so other users on the machine can't read it:

```bash
chmod 600 .env
```

### If you sign in to Tonal with Google or Apple

The library needs an email and password, so you'll need to set one on your
account first. In the Tonal app: **Profile → Settings → Account**, and set a
password (or use the "forgot password" flow on the email address tied to your
Google/Apple sign-in to create one). Your existing sign-in method keeps working —
you're just adding a second way in.

### If your household shares a Tonal

Tonal accounts are per-person, and the sync reads whichever profile the
credentials belong to. Use the account of the person whose workouts should go to
Garmin. One service instance syncs one person; to sync two people, run two
instances with separate `.env` files, separate `DATA_DIR`s and different ports.

## Check that it works

```bash
npm run verify
```

This authenticates, finds your most recent completed workout, and prints the
structure of what it got back. Nothing is uploaded to Garmin and nothing is
saved.

Healthy output looks roughly like this:

```
Connecting to Tonal...

Found 143 activity summaries.

--- Newest completed summary ---
summary keys: id, name, completed, timestamp, duration, totalReps, ...
candidate ids: { id: '9f3c...', workoutActivityId: undefined, workoutId: undefined }

Fetching detail for activityId=9f3c... ...

--- Detail ---
detail keys: id, name, duration, workoutSetActivity, workoutHeartRate, calories, ...
set array field: workoutSetActivity
set count: 32

first set keys: movementId, repCount, baseWeight, beginTime, endTime, duration, ...
```

The things to check: **set count is greater than 0**, and **set array field**
says `workoutSetActivity`.

> **Privacy:** the output includes one real set from your latest workout. Redact
> it before pasting anywhere public.

## When it fails

| What you see | What it means | What to do |
| --- | --- | --- |
| `Set TONAL_EMAIL and TONAL_PASSWORD in env / .env` | The service can't see your `.env` | Check you copied `.env.example` to `.env`, in the repo root |
| Login/authentication error | Wrong credentials, or a Google/Apple-only account | Sign in to the Tonal app with that exact email and password. If you can't, set a password (above) |
| `Found 0 activity summaries` | Login worked, but this account has no workouts | Check you used the right profile's account |
| `Could not determine Tonal userId` | Login worked but the account shape is unexpected | Open an issue with this message |
| `set count: 0` or `set array field: (none found)` | Tonal changed the detail payload | Open an issue and include the `detail keys:` line — that's what's needed to fix it |
| Everything hangs or times out | Tonal's API is unreachable | Check the machine has internet; try again later |

If the field names in the output don't match what the table above describes,
Tonal has probably changed something. The `detail keys:` and `first set keys:`
lines are exactly what's needed to fix it — please open an issue with those
(and only those).

## Next

Now set up Garmin: [garmin-access.md](garmin-access.md).
