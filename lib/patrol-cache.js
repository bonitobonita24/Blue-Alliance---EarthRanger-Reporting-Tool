import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const CACHE_PATH = process.env.PATROL_CACHE_PATH || '/app/data/patrol-cache.json';
const CACHE_VERSION = 1;
const CACHE_RETRIES = 3;

let writePromise = Promise.resolve();

export async function upsertPatrols(patrols = [], source = 'api') {
  if (!Array.isArray(patrols) || !patrols.length) return getCacheStats();

  const cache = await loadCache();
  const now = new Date().toISOString();

  for (const patrol of patrols) {
    const key = getPatrolKey(patrol);
    if (!key) continue;

    const current = cache.patrols[key] || {};
    cache.patrols[key] = {
      firstSeenAt: current.firstSeenAt || now,
      lastFetchedAt: now,
      lastSyncedAt: source === 'sync' ? now : current.lastSyncedAt || null,
      source,
      syncNeeded: shouldKeepSyncing(patrol),
      patrol
    };
  }

  cache.updatedAt = now;
  await saveCache(cache);
  return getCacheStats(cache);
}

export async function getCachedPatrols() {
  const cache = await loadCache();
  return Object.values(cache.patrols).map((entry) => entry.patrol);
}

export async function getSyncCandidatePatrols(limit = 100) {
  const cache = await loadCache();
  return Object.values(cache.patrols)
    .filter((entry) => entry.syncNeeded || shouldKeepSyncing(entry.patrol))
    .sort((left, right) => {
      const leftTime = new Date(left.lastSyncedAt || left.lastFetchedAt || left.firstSeenAt || 0).getTime();
      const rightTime = new Date(right.lastSyncedAt || right.lastFetchedAt || right.firstSeenAt || 0).getTime();
      return leftTime - rightTime;
    })
    .slice(0, limit)
    .map((entry) => entry.patrol);
}

export async function clearCache() {
  const empty = normalizeCache();
  empty.updatedAt = new Date().toISOString();
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  const tempPath = `${CACHE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(empty, null, 2)}\n`);
  await rename(tempPath, CACHE_PATH);
  return getCacheStats(empty);
}

export async function getCacheStats(cacheInput) {
  const cache = cacheInput || await loadCache();
  const entries = Object.values(cache.patrols);
  const syncNeeded = entries.filter((entry) => entry.syncNeeded || shouldKeepSyncing(entry.patrol)).length;

  return {
    path: CACHE_PATH,
    totalCached: entries.length,
    syncNeeded,
    updatedAt: cache.updatedAt
  };
}

export function getPatrolKey(patrol) {
  if (!patrol || typeof patrol !== 'object') return '';
  return String(patrol.id || patrol.uuid || patrol.serial_number || '').trim();
}

export function shouldKeepSyncing(patrol) {
  if (!patrol || typeof patrol !== 'object') return false;

  const state = String(patrol.state || '').toLowerCase();
  if (['closed', 'done', 'completed', 'cancelled', 'canceled'].includes(state)) return false;

  const segments = Array.isArray(patrol.patrol_segments) ? patrol.patrol_segments : [];
  if (!segments.length) return state === 'open';

  return segments.some((segment) => {
    const range = segment.time_range || {};
    return Boolean(range.start_time || segment.scheduled_start) && !Boolean(range.end_time || segment.scheduled_end);
  });
}

async function loadCache() {
  for (let attempt = 1; attempt <= CACHE_RETRIES; attempt += 1) {
    try {
      const content = await readFile(CACHE_PATH, 'utf8');
      return normalizeCache(JSON.parse(content));
    } catch (error) {
      if (error.code === 'ENOENT') return normalizeCache();
      if (attempt === CACHE_RETRIES) {
        console.warn(`Unable to read patrol cache: ${error.message}`);
        return normalizeCache();
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }

  return normalizeCache();
}

function normalizeCache(cache = {}) {
  return {
    version: CACHE_VERSION,
    updatedAt: cache.updatedAt || null,
    patrols: cache.patrols && typeof cache.patrols === 'object' ? cache.patrols : {}
  };
}

async function saveCache(cache) {
  writePromise = writePromise.then(async () => {
    const diskCache = await loadCache();
    const mergedCache = normalizeCache({
      updatedAt: cache.updatedAt,
      patrols: {
        ...diskCache.patrols,
        ...cache.patrols
      }
    });

    await mkdir(dirname(CACHE_PATH), { recursive: true });
    const tempPath = `${CACHE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(mergedCache, null, 2)}\n`);
    await rename(tempPath, CACHE_PATH);
  });
  await writePromise;
}
