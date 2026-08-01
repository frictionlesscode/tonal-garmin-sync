/**
 * Backfill: sync the last N completed Tonal workouts that aren't already in the
 * dedup log — for when the trigger missed some, or when you first set the
 * service up and want your recent history in Garmin.
 *
 *   npm run backfill                # last 6, actually upload
 *   npm run backfill -- 10          # last 10
 *   npm run backfill -- 10 --dry    # dry run: just list what would sync
 *
 * Already-synced workouts are skipped, so re-running this is safe.
 */
import { loadConfig } from '../src/config.js';
import { SyncService } from '../src/sync.js';
import type { SyncResult } from '../src/sync.js';
import type { TonalActivitySummaryLoose } from '../src/types.js';

const LABELS: Record<SyncResult['status'], string> = {
  synced: 'SYNCED',
  duplicate: 'DUPLICATE',
  skipped: 'SKIP',
  'would-sync': 'WOULD SYNC',
  'no-activity': 'NONE',
};

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const count = Number.parseInt(args.find((a) => /^\d+$/.test(a)) ?? '6', 10);

  const service = new SyncService(loadConfig());
  await service.init();

  console.log(`Last ${count} completed activities${dryRun ? ' (DRY RUN — nothing is uploaded)' : ''}:\n`);

  const print = (result: SyncResult, summary: TonalActivitySummaryLoose): void => {
    const when = String(summary.timestamp ?? summary.localTimestamp ?? '').slice(0, 16);
    const name = result.name ?? String(summary.name ?? '');
    const sets = result.setCount !== undefined ? `  (${result.setCount} sets)` : '';
    console.log(`  ${LABELS[result.status].padEnd(11)} ${when}  ${name}${sets}`);
  };

  await service.runSyncRecent(count, { dryRun, onResult: print });
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
