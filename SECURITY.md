# Security

This service holds credentials for two accounts you care about. Here is exactly
what it stores, why, and what you should do about it.

## What's stored, and how sensitive it is

| What | Where | How bad if leaked |
| --- | --- | --- |
| **Tonal email + password, in plaintext** | `.env` | **Severe.** Full access to your Tonal account. |
| **Garmin token store** | `data/garmin-tokens/garmin_tokens.json` | **Severe.** Equivalent to a logged-in Garmin session — readable *and* writable — without needing your password or 2FA. |
| **Webhook secret** | `.env`, and Home Assistant's `secrets.yaml` | Moderate. Lets someone trigger a sync. It can't read your data back. |
| **Sync log** | `data/sync-state.json` | Mild. Workout names, timestamps and set counts. |

### Why your Tonal password is in a plaintext file

Because Tonal offers no alternative. There is no public API, no OAuth, no
personal access tokens, and no app passwords — the only way to authenticate is
the same email-and-password login the mobile app uses, which means the service
needs the real password to hand.

That is a genuine downside and you should weigh it before installing this. If it
bothers you, consider changing your Tonal password to one you don't reuse
anywhere else, so the blast radius is limited to Tonal.

Garmin is better: after the one-time interactive bootstrap, no Garmin password
is stored anywhere. See [docs/garmin-access.md](docs/garmin-access.md).

## What you should do

**Lock down the files.**

```bash
chmod 600 .env
chmod 700 data/garmin-tokens
```

**Never commit secrets.** `.gitignore` already excludes `.env`, `data/` and
`*.fit`. Before your first push:

```bash
git status --ignored     # confirm .env and data/ are listed as ignored
```

**Don't expose `/sync` to the internet.** Do not port-forward it, and do not put
it on a public hostname. It is designed for a trusted LAN. The webhook secret is
compared in constant time and the endpoint does nothing but trigger a sync, but
there is no rate limiting and no reason to take the risk.

**Use a real random webhook secret**, not something you invented:

```bash
openssl rand -hex 32
```

**Redact before you share.** `npm run verify`, `npm run check:hr` and
`npm run inspect:fit` all print your own workout data. Strip it before pasting
into an issue — see [CONTRIBUTING.md](CONTRIBUTING.md).

## How the service protects things

- The webhook secret is compared by SHA-256 digest with `timingSafeEqual`, so
  neither the value nor its length leaks through timing.
- `/sync` failures return a generic message; the detail goes to the container
  log only, so exception text can't leak paths or upstream API responses to a
  caller.
- Request logging records method, URL and remote address — never headers, so the
  webhook secret is not written to the log.
- The Garmin bootstrap reads your password and MFA code from an interactive
  prompt. They are never written to `.env`, never passed as command-line
  arguments (which would be visible in the process list), and never logged.
- The container runs as a non-root user (uid 1000).
- No telemetry, no analytics, no outbound connections other than Tonal and
  Garmin.

## Reporting a vulnerability

Please open a GitHub issue for anything low-risk. For something genuinely
sensitive, use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability) rather than a public issue.

This is a hobby project maintained in spare time — there is no SLA, and no
warranty of any kind (see [LICENSE](LICENSE)).
