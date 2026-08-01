/**
 * Manually run a single sync without going through the webhook. Useful for
 * end-to-end testing on the box after a real Tonal workout:
 *
 *   npm run sync:once
 */
import { loadConfig } from '../src/config.js';
import { SyncService } from '../src/sync.js';

async function main() {
  const service = new SyncService(loadConfig());
  await service.init();
  const result = await service.runSync();
  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('sync-once failed:', err);
  process.exit(1);
});
