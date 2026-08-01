# Home Assistant setup (Android)

This gets you a sync that fires within a minute of finishing a workout, off the
Tonal notification your phone already receives.

> **iPhone users: this page won't work for you.** iOS doesn't let any app read
> another app's notifications, so the sensor this relies on doesn't exist on
> iOS — it's a platform restriction, not a Home Assistant gap. Use
> [iphone.md](iphone.md) instead; polling works well.

**Before you start**, the service should be running and both credentials working
([tonal-access.md](tonal-access.md), [garmin-access.md](garmin-access.md)).

---

## 1. Enable the "Last notification" sensor

On your phone, in the Home Assistant Companion app:

**Settings → Companion app → Manage sensors → Last notification → toggle on**

It is **off by default**.

## 2. Grant notification access

The same screen will prompt for **Notification Access**, an Android system
permission. Grant it.

Without it the sensor exists but stays `unavailable` forever.

## 3. ⚠️ Turn off the allow-list requirement

**This is the step that silently breaks everything, and it's easy to miss.**

Recent Companion app versions only populate the "Last notification" sensor for
apps on an allow-list. Until you deal with this, the sensor will look enabled,
report no errors, and simply never update — with no indication why.

On the same **Last notification** settings screen, either:

- turn off the setting requiring notifications to be allow-listed, **or**
- add Tonal to the allow-list explicitly.

The wording moves around between app versions — look for anything about
*allowed packages* or *only send notifications from selected apps*.

## 4. Find your sensor and your package name

Do a Tonal workout (or just wait for any Tonal notification), then in Home
Assistant:

**Developer Tools → States**, filter for `last_notification`.

You're looking for `sensor.<your_phone_name>_last_notification` — for example
`sensor.pixel_9_last_notification`. **Write down the exact entity id**; you need
it in step 6.

Click it and look at the attributes. You want `package`:

```yaml
package: com.tonal.companion
```

It's `com.tonal.companion` today, but **check yours** rather than assuming — app
package names do change.

> If the sensor doesn't exist, or its state never changes after a Tonal
> notification, go back to step 3. That's almost always the cause.

## 5. Add the webhook call

In `configuration.yaml`:

```yaml
rest_command:
  tonal_garmin_sync:
    url: "http://SERVICE-HOST:8090/sync"
    method: POST
    headers:
      x-webhook-secret: !secret tonal_garmin_webhook_secret
```

Replace `SERVICE-HOST` with the IP or hostname of the machine running the
service — from Home Assistant's point of view. If HA and the service are in
containers on the same host, use the host's LAN IP, not `localhost`.

In `secrets.yaml`, put the same value as `WEBHOOK_SECRET` in your `.env`:

```yaml
tonal_garmin_webhook_secret: "the-same-long-random-string-from-your-env"
```

Then **Developer Tools → YAML → Reload all YAML configuration** (or restart HA).

## 6. Add the automation

**Settings → Automations & scenes → Create automation → Edit in YAML**, and
paste this, replacing the two `sensor.your_phone_last_notification` references
with your entity id from step 4:

```yaml
alias: Sync Tonal workout to Garmin
description: ''
triggers:
  - trigger: state
    entity_id: sensor.your_phone_last_notification
conditions:
  - condition: template
    value_template: >
      {{ state_attr('sensor.your_phone_last_notification', 'package')
           == 'com.tonal.companion'
         and trigger.from_state is not none
         and trigger.from_state.state not in ['unavailable', 'unknown'] }}
actions:
  - delay: '00:00:45'
  - action: rest_command.tonal_garmin_sync
mode: single
```

Three details that matter, all learned the hard way:

- **It matches on `package`, not on the notification text.** Tonal randomises its
  completion messages, so text matching works until one day it doesn't.
- **The `from_state` guard** stops a sync firing when Home Assistant restarts and
  the sensor goes `unknown` → `<value>`.
- **The 45-second delay** gives Tonal time to finalise the workout server-side.
  Without it you can sync a workout that isn't finished being written yet.

You may notice this fires on *every* Tonal notification, not just workout
completions. That's intentional and harmless: the service dedups, so extra
triggers just return `skipped`.

## 7. Test it without doing a workout

From any machine that can reach the service:

```bash
curl -X POST http://SERVICE-HOST:8090/sync -H "x-webhook-secret: YOUR-SECRET"
```

| Response | Meaning |
| --- | --- |
| `{"status":"synced","activityId":"...","setCount":32}` | Worked — check Garmin Connect |
| `{"status":"skipped",...}` | Already synced. Normal and correct |
| `{"status":"duplicate",...}` | Garmin already had it (409) |
| `{"status":"no-activity"}` | No completed workouts on the Tonal account |
| `{"error":"unauthorized"}` (401) | Secret doesn't match `WEBHOOK_SECRET` |
| `{"error":"sync failed",...}` (500) | Something broke — check the container logs |
| Connection refused / timeout | Wrong host or port, or the service isn't running |

Then test the automation end to end: **Settings → Automations → your automation
→ ⋮ → Run**. It skips the trigger but runs the delay and the webhook call.

Finally, do a real workout and watch it arrive.

## 8. Recommended: add a backstop poll

The notification trigger is instant but not bulletproof — phone reboots, Home
Assistant downtime, and Android killing the Companion app all cause missed
workouts. A slow poll catches anything that slipped through. In `.env`:

```bash
POLL_INTERVAL_MINUTES=360
```

Six hours costs four extra API calls a day and means a missed notification
delays a sync instead of losing it. See [iphone.md](iphone.md) for details.

## When it doesn't work

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sensor doesn't exist | Not enabled | Step 1 |
| Sensor is `unavailable` | No Notification Access | Step 2 |
| Sensor exists but never updates | **Allow-list requirement** | Step 3 — this is nearly always it |
| Automation never fires | Wrong entity id or package name | Steps 4 and 6 |
| Automation runs, nothing syncs | HA can't reach the service | Check the URL; try the `curl` from the HA host |
| 401 in the HA logs | Secret mismatch | `secrets.yaml` must match `.env` exactly, no quotes mismatch |
| 415 Unsupported Media Type | Old version of this service | Update — current versions accept any content type |

More in [troubleshooting.md](troubleshooting.md).
