---
name: Bug report
about: Something isn't working
title: ''
labels: bug
assignees: ''
---

<!--
⚠️ REDACT YOUR PERSONAL DATA FIRST.

The diagnostic scripts and the container logs print your own workout data —
workout names, exercises, reps, weights, heart rate, timestamps.

Replace those with placeholders. KEEP field names, movement UUIDs, error
messages and status codes: those are the useful parts.

NEVER paste: .env contents, your webhook secret, or anything from
data/garmin-tokens/. Those are live credentials.
-->

**What happened**


**What you expected**


**How it's triggered**
- [ ] Home Assistant notification (Android)
- [ ] Polling (`POLL_INTERVAL_MINUTES`)
- [ ] Manual `curl` / `npm run sync:once`
- [ ] `npm run backfill`

**Setup**
- Running via: <!-- docker compose / node directly -->
- Host: <!-- e.g. TrueNAS, Raspberry Pi, Synology, Ubuntu VM -->
- Phone: <!-- Android / iPhone / n-a -->
- Version or commit:

**Does `npm run verify` succeed?**
<!-- yes / no — and if no, the error (this tells us whether it's Tonal-side) -->

**Logs** (redacted)

```
paste here
```
