/**
 * One-time Garmin Connect token bootstrap.
 *
 *   npm run bootstrap:garmin
 *
 * Garmin's login sits behind a Cloudflare WAF that rate-limits the mobile SSO
 * endpoint, and most accounts have MFA — so the service can't log in with a
 * password on its own. Instead you log in once, interactively, here. That mints
 * a token store which the service then uses on its own; no password and no MFA
 * code are involved at sync time.
 *
 * You type your email, password and MFA code directly into the Python prompt
 * below. They are never written to .env, never passed as arguments, and never
 * logged — only the resulting tokens are saved, to:
 *
 *   $DATA_DIR/garmin-tokens/garmin_tokens.json
 *
 * Treat that file like a password. Tokens last about a year and refresh
 * themselves; when they finally expire, uploads fail with a message telling you
 * to run this again.
 *
 * See docs/garmin-access.md.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DATA_DIR || './data';
const tokenDir = path.join(dataDir, 'garmin-tokens');
const python = process.env.GARMIN_PYTHON ?? 'python3';
const script = fileURLToPath(new URL('../python/garmin_bootstrap.py', import.meta.url));

mkdirSync(tokenDir, { recursive: true });

console.log(`Minting Garmin tokens into ${tokenDir}`);
console.log('Expect a 30-45 second pause during login — that delay is deliberate, not a hang.\n');

// stdio: 'inherit' so the password and MFA prompts are a direct conversation
// between you and Python. Nothing passes through this process.
const res = spawnSync(python, [script, tokenDir], { stdio: 'inherit' });

if (res.error) {
  console.error(
    `\nCould not run "${python}": ${res.error.message}\n` +
      `Install Python 3, or set GARMIN_PYTHON to its path. If you're running the ` +
      `service in Docker, use the container instead — see docs/garmin-access.md.`,
  );
  process.exit(1);
}
process.exit(res.status ?? 1);
