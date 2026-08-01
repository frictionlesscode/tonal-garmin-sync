import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.GARMIN_PYTHON ?? '/opt/garmin-venv/bin/python';
const UPLOAD_SCRIPT = process.env.GARMIN_UPLOAD_SCRIPT ?? '/app/python/garmin_upload.py';

export interface UploadResult {
  status: 'uploaded' | 'duplicate';
  uploadId?: string | number;
}

interface UploaderResult {
  status: 'uploaded' | 'duplicate' | 'auth_error' | 'error';
  uploadId?: string | number;
  error?: string;
}

/**
 * Garmin Connect upload via the maintained Python `garminconnect` library.
 *
 * Garmin's 2026 auth (Cloudflare WAF + DI-token scheme) is handled by
 * garminconnect, whose token store is incompatible with the Node garmin-connect
 * library — so we mint tokens once (see README "Garmin MFA") and shell out to
 * python/garmin_upload.py for the single upload call. The Python side loads the
 * token store from DATA_DIR/garmin-tokens and refreshes tokens as needed; no
 * password or MFA code is used at runtime.
 */
export class Garmin {
  private readonly tokenDir: string;

  constructor(_email: string | undefined, dataDir: string) {
    this.tokenDir = path.join(dataDir, 'garmin-tokens');
  }

  /** Confirm a token store exists; actual auth happens in the Python uploader. */
  async connect(): Promise<void> {
    try {
      await fs.access(path.join(this.tokenDir, 'garmin_tokens.json'));
    } catch {
      throw new Error(
        `Garmin token store missing at ${this.tokenDir}/garmin_tokens.json. ` +
          `Run the one-time token bootstrap (see README "Garmin MFA").`,
      );
    }
  }

  /** Upload FIT bytes; Garmin's 409 (already exists) maps to a duplicate. */
  async uploadFit(bytes: Uint8Array, baseName: string): Promise<UploadResult> {
    const tmp = path.join(os.tmpdir(), `${sanitize(baseName)}-${Date.now()}.fit`);
    await fs.writeFile(tmp, bytes);
    try {
      const { stdout } = await execFileAsync(PYTHON_BIN, [UPLOAD_SCRIPT, tmp, this.tokenDir], {
        maxBuffer: 16 * 1024 * 1024,
      });
      return interpret(parseResult(stdout));
    } catch (err) {
      // execFile rejects on non-zero exit; the script still prints a RESULT line.
      const e = err as { stdout?: string; message?: string };
      if (e.stdout) return interpret(parseResult(e.stdout));
      throw new Error(`Garmin uploader failed to run: ${e.message ?? String(err)}`);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
}

function interpret(res: UploaderResult): UploadResult {
  if (res.status === 'duplicate') return { status: 'duplicate' };
  if (res.status === 'uploaded') return { status: 'uploaded', uploadId: res.uploadId };
  throw new Error(`Garmin upload ${res.status}: ${res.error ?? 'unknown error'}`);
}

function parseResult(stdout: string): UploaderResult {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith('RESULT:'));
  if (!line) {
    return { status: 'error', error: `no RESULT from uploader: ${stdout.slice(-400)}` };
  }
  try {
    return JSON.parse(line.slice('RESULT:'.length)) as UploaderResult;
  } catch {
    return { status: 'error', error: `unparseable RESULT: ${line.slice(0, 300)}` };
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'tonal';
}
