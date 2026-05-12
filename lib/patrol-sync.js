import { getPatrol, getPatrols } from './earthranger.js';
import { getCacheStats, getPatrolKey, getSyncCandidatePatrols, upsertPatrols } from './patrol-cache.js';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_LATEST_PAGE_SIZE = 100;
const DEFAULT_LATEST_PAGES = 5;
const DEFAULT_CANDIDATE_LIMIT = 75;

let timer;
let running = false;
let lastRun = null;
let lastError = null;

export function startPatrolSync() {
  const intervalMs = Number(process.env.PATROL_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (timer || intervalMs <= 0) return;

  runPatrolSync();
  timer = setInterval(runPatrolSync, intervalMs);
  timer.unref?.();
}

export async function runPatrolSync() {
  if (running) return getPatrolSyncStatus();
  running = true;

  const startedAt = new Date().toISOString();
  let latestSaved = 0;
  let latestPagesChecked = 0;
  let candidatesChecked = 0;
  let candidatesSaved = 0;

  try {
    const latestPageSize = Number(process.env.PATROL_SYNC_LATEST_PAGE_SIZE || DEFAULT_LATEST_PAGE_SIZE);
    const latestPages = Number(process.env.PATROL_SYNC_LATEST_PAGES || DEFAULT_LATEST_PAGES);

    for (let page = 1; page <= latestPages; page += 1) {
      const latest = await getPatrols({ page, page_size: latestPageSize, sort_by: '-serial_number' });
      const latestResults = Array.isArray(latest?.data?.results) ? latest.data.results : [];
      latestPagesChecked += 1;
      latestSaved += latestResults.length;
      await upsertPatrols(latestResults, 'sync');
      if (!latest?.data?.next || latestResults.length < latestPageSize) break;
    }

    const candidateLimit = Number(process.env.PATROL_SYNC_CANDIDATE_LIMIT || DEFAULT_CANDIDATE_LIMIT);
    const candidates = await getSyncCandidatePatrols(candidateLimit);
    candidatesChecked = candidates.length;

    for (const candidate of candidates) {
      const key = getPatrolKey(candidate);
      if (!key) continue;

      const refreshed = await getPatrol(key);
      const patrol = refreshed?.data || refreshed;
      if (patrol && typeof patrol === 'object') {
        await upsertPatrols([patrol], 'sync');
        candidatesSaved += 1;
      }
    }

    lastError = null;
  } catch (error) {
    lastError = error.message;
    console.warn(`Patrol sync failed: ${error.message}`);
  } finally {
    lastRun = {
      startedAt,
      finishedAt: new Date().toISOString(),
      latestPagesChecked,
      latestSaved,
      candidatesChecked,
      candidatesSaved
    };
    running = false;
  }

  return getPatrolSyncStatus();
}

export async function getPatrolSyncStatus() {
  return {
    enabled: Number(process.env.PATROL_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS) > 0,
    running,
    intervalMs: Number(process.env.PATROL_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    lastRun,
    lastError,
    cache: await getCacheStats()
  };
}
