import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Tiny JSON-file-backed state store.
 *
 * Chosen over SQLite to avoid a native build dependency (better-sqlite3 needs a
 * compiler toolchain in the image). The dataset here is tiny — a set of synced
 * activity ids plus a small audit log — so a single atomically-written JSON file
 * is more than sufficient.
 */

export interface SyncRecord {
  activityId: string;
  name: string;
  syncedAt: string; // ISO
  garminStatus: 'uploaded' | 'duplicate';
  garminUploadId?: string | number;
  setCount: number;
}

interface StoreData {
  syncedActivities: Record<string, SyncRecord>;
}

export class Store {
  private readonly file: string;
  private data: StoreData = { syncedActivities: {} };
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'sync-state.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      this.data = { syncedActivities: parsed.syncedActivities ?? {} };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.flush();
      } else {
        throw err;
      }
    }
  }

  isSynced(activityId: string): boolean {
    return Boolean(this.data.syncedActivities[activityId]);
  }

  getRecord(activityId: string): SyncRecord | undefined {
    return this.data.syncedActivities[activityId];
  }

  async recordSync(record: SyncRecord): Promise<void> {
    this.data.syncedActivities[record.activityId] = record;
    await this.flush();
  }

  /**
   * Serialize writes and write atomically (temp file + rename).
   *
   * The chain is advanced with a settled promise so one failed write can't
   * poison it — if it did, every later recordSync() would silently no-op and
   * dedup would stop working. The caller still sees the real error.
   */
  private flush(): Promise<void> {
    const write = this.writeChain.then(
      () => this.writeOnce(),
      () => this.writeOnce(),
    );
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  private async writeOnce(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
