import { getPatrol, getPatrols } from './earthranger.js';
import { getCacheStats, getPatrolKey, getSyncCandidatePatrols, upsertPatrols } from './patrol-cache.js';

const ACTIVE_CHECK_INTERVAL_MS = Number(process.env.ACTIVE_CHECK_INTERVAL_MS || 120_000);
const DEEP_SYNC_INTERVAL_MS = Number(process.env.DEEP_SYNC_INTERVAL_MS || 600_000);
const DEEP_SYNC_PAGE_SIZE = 200;
const DEEP_SYNC_MAX_PAGES = 100;
const LATEST_PAGE_SIZE = Number(process.env.PATROL_SYNC_LATEST_PAGE_SIZE || 100);
const LATEST_PAGES = Number(process.env.PATROL_SYNC_LATEST_PAGES || 5);

let activeCheckTimer;
let deepSyncTimer;
let running = false;
let lastActiveCheck = null;
let lastDeepSync = null;
let lastError = null;

export function startPatrolSync() {
  if (activeCheckTimer) return;

  console.log(`Patrol sync engine starting — active check every ${ACTIVE_CHECK_INTERVAL_MS / 1000}s, deep sync every ${DEEP_SYNC_INTERVAL_MS / 1000}s`);

  runDeepSync();

  activeCheckTimer = setInterval(runActiveCheck, ACTIVE_CHECK_INTERVAL_MS);
  activeCheckTimer.unref?.();

  deepSyncTimer = setInterval(runDeepSync, DEEP_SYNC_INTERVAL_MS);
  deepSyncTimer.unref?.();
}

export async function runActiveCheck() {
  if (running) return;
  running = true;

  const startedAt = new Date().toISOString();
  let latestSaved = 0;
  let latestPages = 0;
  let candidatesChecked = 0;
  let candidatesUpdated = 0;

  try {
    for (let page = 1; page <= LATEST_PAGES; page += 1) {
      const result = await getPatrols({ page, page_size: LATEST_PAGE_SIZE, sort_by: '-serial_number' });
      const results = Array.isArray(result?.data?.results) ? result.data.results : [];
      latestPages += 1;
      latestSaved += results.length;
      await upsertPatrols(results, 'sync');
      if (!result?.data?.next || results.length < LATEST_PAGE_SIZE) break;
    }

    const candidates = await getSyncCandidatePatrols(50);
    candidatesChecked = candidates.length;

    for (const candidate of candidates) {
      const key = getPatrolKey(candidate);
      if (!key) continue;
      try {
        const refreshed = await getPatrol(key);
        const patrol = refreshed?.data || refreshed;
        if (patrol && typeof patrol === 'object') {
          await upsertPatrols([patrol], 'sync');
          candidatesUpdated += 1;
        }
      } catch (_) {}
    }

    lastError = null;
  } catch (error) {
    lastError = error.message;
    console.warn(`Active check failed: ${error.message}`);
  } finally {
    lastActiveCheck = {
      startedAt,
      finishedAt: new Date().toISOString(),
      latestPages,
      latestSaved,
      candidatesChecked,
      candidatesUpdated
    };
    running = false;
  }
}

export async function runDeepSync() {
  if (running) return getPatrolSyncStatus();
  running = true;

  const startedAt = new Date().toISOString();
  let totalPages = 0;
  let totalSaved = 0;

  try {
    console.log('Deep sync started — fetching all patrols from EarthRanger...');

    let page = 1;
    while (page <= DEEP_SYNC_MAX_PAGES) {
      const result = await getPatrols({ page, page_size: DEEP_SYNC_PAGE_SIZE, sort_by: '-serial_number' });
      const results = Array.isArray(result?.data?.results) ? result.data.results : [];
      if (!results.length) break;

      totalPages += 1;
      totalSaved += results.length;
      await upsertPatrols(results, 'sync');

      if (!result?.data?.next || results.length < DEEP_SYNC_PAGE_SIZE) break;
      page += 1;
    }

    lastError = null;
    console.log(`Deep sync complete — ${totalPages} pages, ${totalSaved} patrols saved`);
  } catch (error) {
    lastError = error.message;
    console.warn(`Deep sync failed: ${error.message}`);
  } finally {
    lastDeepSync = {
      startedAt,
      finishedAt: new Date().toISOString(),
      totalPages,
      totalSaved
    };
    running = false;
  }

  return getPatrolSyncStatus();
}

export async function getPatrolSyncStatus() {
  return {
    running,
    activeCheckIntervalMs: ACTIVE_CHECK_INTERVAL_MS,
    deepSyncIntervalMs: DEEP_SYNC_INTERVAL_MS,
    lastActiveCheck,
    lastDeepSync,
    lastError,
    cache: await getCacheStats()
  };
}
