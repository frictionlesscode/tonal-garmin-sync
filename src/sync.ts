import type { Config } from './config.js';
import { Tonal, activityIdOf } from './tonal.js';
import { Movements } from './movements.js';
import { Garmin } from './garmin.js';
import { Store } from './store.js';
import { encodeFit, normalizeWorkout } from './fit.js';
import type { TonalActivitySummaryLoose } from './types.js';

export type SyncStatus = 'synced' | 'duplicate' | 'skipped' | 'no-activity' | 'would-sync';

export interface SyncResult {
  status: SyncStatus;
  activityId?: string;
  name?: string;
  setCount?: number;
}

export interface SyncRecentOptions {
  /** Report what would sync without encoding or uploading anything. */
  dryRun?: boolean;
  /** Called as each activity is resolved, for progress output in CLI scripts. */
  onResult?: (result: SyncResult, summary: TonalActivitySummaryLoose) => void;
}

/**
 * Orchestrates syncing: find completed Tonal workouts -> dedup -> fetch per-set
 * detail -> encode FIT -> upload to Garmin -> record.
 *
 * Connections are established lazily and reused. Runs are serialized via a mutex
 * so a webhook call, a poll tick, and a manual run can't double-process the same
 * workout.
 */
export class SyncService {
  private tonal?: Tonal;
  private movements?: Movements;
  private garmin?: Garmin;
  private readonly store: Store;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: Config) {
    this.store = new Store(config.dataDir);
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  /**
   * Sync the single most recent completed workout. This is what the webhook
   * calls: the trigger carries no workout id, it just means "something finished".
   */
  async runSync(): Promise<SyncResult> {
    const results = await this.runSyncRecent(1);
    return results[0] ?? { status: 'no-activity' };
  }

  /**
   * Sync up to the last `count` completed workouts that aren't already recorded,
   * oldest first. Used by the poller (which may have missed a workout while the
   * service was down) and by the backfill script.
   */
  runSyncRecent(count: number, options: SyncRecentOptions = {}): Promise<SyncResult[]> {
    // Queue behind whatever is already running, regardless of how it settles.
    const next = this.chain.then(
      () => this.doSyncRecent(count, options),
      () => this.doSyncRecent(count, options),
    );
    this.chain = next;
    return next;
  }

  private async ensureConnected(needGarmin: boolean): Promise<void> {
    if (!this.tonal) {
      this.tonal = await Tonal.connect(this.config.tonalEmail, this.config.tonalPassword);
    }
    if (!this.movements) {
      this.movements = new Movements(this.tonal, this.config.dataDir);
      await this.movements.load();
    }
    if (needGarmin && !this.garmin) {
      this.garmin = new Garmin(this.config.garminEmail, this.config.dataDir);
      await this.garmin.connect();
    }
  }

  /**
   * Drop the cached Tonal client so the next sync attempt logs in fresh.
   *
   * ts-tonal-client manages its own session token internally, and its refresh
   * occasionally fails outright after the client has sat idle for days
   * ("Token expired and refresh failed. Call authenticate() first.") — with no
   * way to recover that one client. Without this, every sync after that point
   * would fail until the process restarted. Movements holds a reference to the
   * Tonal client, so it has to be dropped too.
   */
  private dropTonalClient(): void {
    this.tonal = undefined;
    this.movements = undefined;
  }

  /** Run a Tonal call, discarding the cached client on failure so the next attempt reconnects. */
  private async callTonal<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.dropTonalClient();
      throw err;
    }
  }

  private async doSyncRecent(count: number, options: SyncRecentOptions): Promise<SyncResult[]> {
    // A dry run never touches Garmin, so don't demand a token store for it.
    await this.ensureConnected(!options.dryRun);

    const summaries = await this.callTonal(() => this.tonal!.getRecentCompletedActivities(count));
    if (summaries.length === 0) {
      console.log('[sync] no completed Tonal activity found');
      return [{ status: 'no-activity' }];
    }

    const results: SyncResult[] = [];
    for (const summary of summaries) {
      const result = await this.syncActivity(summary, options);
      results.push(result);
      options.onResult?.(result, summary);
    }
    return results;
  }

  private async syncActivity(
    summary: TonalActivitySummaryLoose,
    options: SyncRecentOptions,
  ): Promise<SyncResult> {
    const activityId = activityIdOf(summary);
    if (this.store.isSynced(activityId)) {
      console.log(`[sync] activity ${activityId} already synced — skipping`);
      return { status: 'skipped', activityId, name: String(summary.name ?? '') };
    }

    const detail = await this.callTonal(() => this.tonal!.getWorkoutDetail(activityId));
    const workout = normalizeWorkout(summary, detail, this.movements!, this.config.tonalWeightUnit);
    console.log(
      `[sync] ${workout.name} (${activityId}): ${workout.sets.length} sets, ${workout.totalReps} reps`,
    );

    if (options.dryRun) {
      return { status: 'would-sync', activityId, name: workout.name, setCount: workout.sets.length };
    }

    const bytes = encodeFit(workout, this.config.garminDisplayUnit);
    const upload = await this.garmin!.uploadFit(bytes, workout.name);

    await this.store.recordSync({
      activityId,
      name: workout.name,
      syncedAt: new Date().toISOString(),
      garminStatus: upload.status,
      garminUploadId: upload.uploadId,
      setCount: workout.sets.length,
    });

    console.log(`[sync] ${activityId} -> Garmin: ${upload.status}`);
    return {
      status: upload.status === 'duplicate' ? 'duplicate' : 'synced',
      activityId,
      name: workout.name,
      setCount: workout.sets.length,
    };
  }
}
