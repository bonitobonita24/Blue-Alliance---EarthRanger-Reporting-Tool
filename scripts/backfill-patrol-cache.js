import { getPatrols } from '../lib/earthranger.js';
import { getCacheStats, upsertPatrols } from '../lib/patrol-cache.js';

const pageSize = Number(process.env.PATROL_BACKFILL_PAGE_SIZE || 200);
const maxPages = Number(process.env.PATROL_BACKFILL_MAX_PAGES || 1000);
const maxRetries = Number(process.env.PATROL_BACKFILL_RETRIES || 5);

let page = 1;
let totalFetched = 0;
let expectedTotal = null;

while (page <= maxPages) {
  const payload = await getPatrolPageWithRetry(page);

  const collection = payload?.data || {};
  const results = Array.isArray(collection.results) ? collection.results : [];
  expectedTotal = typeof collection.count === 'number' ? collection.count : expectedTotal;

  if (!results.length) break;

  await upsertPatrols(results, 'backfill');
  totalFetched += results.length;

  console.log(`Backfilled page ${page}: ${results.length} patrols (${totalFetched}/${expectedTotal || 'unknown'})`);

  if (!collection.next || results.length < pageSize) break;
  page += 1;
}

console.log(JSON.stringify({
  fetched: totalFetched,
  expectedTotal,
  cache: await getCacheStats()
}, null, 2));

async function getPatrolPageWithRetry(page) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await getPatrols({
        page,
        page_size: pageSize,
        sort_by: '-serial_number'
      });
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delayMs = attempt * 1500;
      console.warn(`Page ${page} failed on attempt ${attempt}: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
