# iPhone, and syncing without notifications

## Read this first: iOS cannot do the notification trigger

On Android, the Home Assistant Companion app can expose a "Last notification"
sensor because Android provides `NotificationListenerService` — a system API that
lets an app read other apps' notifications.

**iOS has no equivalent, deliberately.** Apple does not permit any app to read
another app's notifications. That's why the Companion app has this sensor on
Android and nothing like it on iOS.

This is worth being blunt about because people lose evenings to it: **no
third-party app, shortcut, or automation server can work around this.** If you
find something claiming otherwise, it's doing something else. There is no iOS
equivalent of the Android trigger and there won't be one.

The good news is that the alternative is genuinely fine.

---

## Option 1: Polling — recommended

The service can check for new workouts on a timer. Set one line in `.env`:

```bash
POLL_INTERVAL_MINUTES=20
```

Restart (`docker compose up -d`) and you're done. **You don't need Home
Assistant at all** for this — polling is built into the service.

You'll see this in the logs on startup:

```
[poll] checking for new workouts every 20 minute(s), looking back 3 activities
```

**The tradeoff:** a workout appears in Garmin up to 20 minutes after you finish,
rather than within a minute. For a strength workout that nobody is racing to look
at, this is almost always fine.

**Why polling is cheap here:** the service already dedups, so a tick that finds
nothing new costs one API call and returns `skipped`. It also checks the last
few activities rather than only the newest, so back-to-back workouts and
anything missed while the service was down both get picked up.

**Why 15 minutes is the floor:** Tonal has no public API — this uses the same
private endpoints their app does. Polling harder than that risks the endpoint
being rate-limited or blocked, which would break it for everyone using this
project. Values below 15 are clamped to 15 with a warning in the log.

Sensible values:

| Setting | Good for |
| --- | --- |
| `15` | You want it as fast as polling gets |
| `20`–`30` | **Recommended.** Fast enough, easy on the API |
| `60` | You just want it there by the time you look |
| `360` | Backstop alongside an Android notification trigger |

### Driving it from Home Assistant instead

If you'd rather Home Assistant own the schedule, leave
`POLL_INTERVAL_MINUTES=0`, set up the `rest_command` from
[home-assistant.md](home-assistant.md#5-add-the-webhook-call) (steps 5 only —
skip the sensor entirely), and add:

```yaml
alias: Poll Tonal for new workouts
triggers:
  - trigger: time_pattern
    minutes: '/20'
actions:
  - action: rest_command.tonal_garmin_sync
mode: single
```

There's no real advantage over the built-in poller unless you want to condition
it on presence, time of day, or something similar.

---

## Option 2: iOS Shortcuts automation — automatic, but UNTESTED

> **This has not been verified by anyone.** It should work, and the caveat below
> is real. Treat it as a bonus on top of polling, not a replacement. If you try
> it, please report back in an issue.

iOS Shortcuts can run an automation when an app closes, and can make an HTTP
request. So: close the Tonal app → sync fires.

**Shortcuts → Automation → New → App**

- **App:** Tonal
- **Is Closed** (not "Is Opened")
- **Run Immediately** — on iOS 17 and later this skips the "Run?" confirmation
  banner, which is what makes it actually automatic

Then add one action, **Get Contents of URL**:

- **URL:** `http://SERVICE-HOST:8090/sync`
- **Method:** `POST`
- **Headers:** `x-webhook-secret` → your `WEBHOOK_SECRET`

> ### ⚠️ The catch
>
> **This only fires if you actually open the Tonal app on your phone.**
>
> Plenty of people only ever touch the trainer's own screen and never open the
> phone app at all. If that's you, this automation will never trigger, and you'll
> never see an error telling you so — it just silently does nothing.
>
> Keep polling enabled underneath it.

Also note this only works while your phone is on the same network as the service
(or via a VPN back home). Don't expose the service to the internet to make it
work from anywhere — see [SECURITY.md](../SECURITY.md).

---

## Option 3: One-tap manual trigger — reliable and instant

If you'd rather have zero latency and don't mind one tap, build the same
**Get Contents of URL** shortcut as above but as a plain shortcut rather than an
automation, and put it somewhere you'll actually hit:

- **Home Screen** — Shortcuts → ⋯ → Add to Home Screen
- **Action Button** (iPhone 15 Pro and later) — Settings → Action Button → Shortcut
- **Back Tap** — Settings → Accessibility → Touch → Back Tap
- **An NFC sticker on the Tonal** — Shortcuts → Automation → NFC. Tap your phone
  to the machine on your way out. This one is genuinely nice.

Add a **Show Result** action at the end and you'll see `{"status":"synced",...}`
as confirmation.

---

## Catching up on anything missed

Whatever you use, this syncs recent workouts that aren't already in Garmin:

```bash
docker compose exec tonal-garmin-sync npm run backfill -- 10 --dry   # preview
docker compose exec tonal-garmin-sync npm run backfill -- 10         # do it
```

Already-synced workouts are skipped, so it's always safe to run.

---

## Android users should read this too

Polling isn't only an iOS fallback. The notification trigger is instant but not
bulletproof — phone reboots, Home Assistant downtime, and Android's battery
optimiser killing the Companion app all cause missed workouts, silently.

Set a slow backstop alongside the notification trigger:

```bash
POLL_INTERVAL_MINUTES=360
```

Four extra API calls a day, and a missed notification becomes a delayed sync
instead of a lost one.
