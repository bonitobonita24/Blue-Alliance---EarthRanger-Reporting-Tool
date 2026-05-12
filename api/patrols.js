import { createPatrol, getPatrols } from '../lib/earthranger.js';

const RANGE_CACHE_TTL_MS = 10 * 60 * 1000;
const rangeCache = globalThis.__patrolRangeCache || new Map();
globalThis.__patrolRangeCache = rangeCache;

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const {
        all,
        from_date,
        max_pages = 40,
        page = 1,
        page_size = 25,
        since,
        to_date,
        until,
        patrol_type,
        status,
        sort_by = '-serial_number'
      } = req.query;

      if (all === 'true') {
        const payload = await getPatrolRange({
          fromDate: from_date,
          maxPages: Number(max_pages) || 40,
          pageSize: Number(page_size) || 200,
          patrolType: patrol_type,
          sortBy: sort_by,
          status,
          toDate: to_date
        });

        return res.status(200).json(payload);
      }

      const patrols = await getPatrols({ page, page_size, since, until, patrol_type, status, sort_by });
      return res.status(200).json(patrols);
    }

    if (req.method === 'POST') {
      const patrol = await createPatrol(req.body || {});
      return res.status(201).json(patrol);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getPatrolRange({ fromDate, maxPages, pageSize, patrolType, sortBy, status, toDate }) {
  const cacheKey = JSON.stringify({ fromDate, maxPages, pageSize, patrolType, sortBy, status, toDate });
  const cached = rangeCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < RANGE_CACHE_TTL_MS) {
    return { ...cached.payload, cache: { hit: true, savedAt: cached.savedAt } };
  }

  const from = fromDate ? startOfDay(fromDate) : null;
  const to = toDate ? endOfDay(toDate) : null;
  const results = [];
  let count = null;
  let reachedEnd = false;
  let page = 1;

  while (page <= maxPages) {
    const payload = await getPatrols({
      page,
      page_size: pageSize,
      patrol_type: patrolType,
      sort_by: sortBy,
      status
    });
    const data = payload?.data || {};
    const pageResults = Array.isArray(data.results) ? data.results : [];

    if (typeof data.count === 'number') count = data.count;
    results.push(...pageResults.filter((patrol) => patrolStartsInRange(patrol, from, to)));

    if (!data.next || !pageResults.length) {
      reachedEnd = true;
      break;
    }

    page += 1;
  }

  const payload = {
    data: {
      count: results.length,
      harvested_count: count,
      max_pages: maxPages,
      next: null,
      pages_loaded: page,
      previous: null,
      reached_end: reachedEnd,
      results
    },
    status: { code: 200, message: 'OK' }
  };

  rangeCache.set(cacheKey, { payload, savedAt: Date.now() });
  return { ...payload, cache: { hit: false, savedAt: Date.now() } };
}

function patrolStartsInRange(patrol, from, to) {
  const start = getPatrolStartDate(patrol);
  if (!start) return false;
  if (from && start < from) return false;
  if (to && start > to) return false;
  return true;
}

function getPatrolStartDate(patrol) {
  const segments = Array.isArray(patrol?.patrol_segments) ? patrol.patrol_segments : [];
  const firstSegment = segments[0] || {};
  const value = firstValue(
    firstSegment.time_range?.start_time,
    firstSegment.scheduled_start,
    patrol?.start_time,
    patrol?.updates?.[0]?.time
  );
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') || '';
}

function startOfDay(value) {
  return new Date(`${value}T00:00:00`);
}

function endOfDay(value) {
  return new Date(`${value}T23:59:59.999`);
}
