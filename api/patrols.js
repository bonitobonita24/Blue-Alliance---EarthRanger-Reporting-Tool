import { createPatrol, getPatrols } from '../lib/earthranger.js';
import { getCachedPatrols, upsertPatrols } from '../lib/patrol-cache.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { page = 1, page_size = 25, since, until, patrol_type, status, sort_by = '-serial_number', source } = req.query;

      if (source === 'cache') {
        const cachedPatrols = await getCachedPatrols();
        return res.status(200).json(buildCachedResponse(cachedPatrols, { page, page_size, sort_by }));
      }

      const patrols = await getPatrols({ page, page_size, since, until, patrol_type, status, sort_by });
      if (Array.isArray(patrols?.data?.results)) {
        patrols.cache = await upsertPatrols(patrols.data.results, 'api');
      }
      return res.status(200).json(patrols);
    }

    if (req.method === 'POST') {
      const patrol = await createPatrol(req.body || {});
      return res.status(201).json(patrol);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (req.method === 'GET') {
      const cachedPatrols = await getCachedPatrols();
      return res.status(200).json({
        data: {
          count: cachedPatrols.length,
          next: null,
          previous: null,
          results: cachedPatrols
        },
        status: {
          code: 200,
          message: `Served from local cache after EarthRanger error: ${error.message}`
        },
        cache: {
          fallback: true
        }
      });
    }

    return res.status(500).json({ error: error.message });
  }
}

function buildCachedResponse(cachedPatrols, { page = 1, page_size = 25, sort_by = '-serial_number' } = {}) {
  const pageNumber = Math.max(1, Number(page) || 1);
  const pageSize = Math.max(1, Number(page_size) || 25);
  const sorted = [...cachedPatrols].sort((left, right) => comparePatrols(left, right, sort_by));
  const start = (pageNumber - 1) * pageSize;
  const results = sorted.slice(start, start + pageSize);

  return {
    data: {
      count: sorted.length,
      next: start + pageSize < sorted.length ? `cache://patrols?page=${pageNumber + 1}` : null,
      previous: pageNumber > 1 ? `cache://patrols?page=${pageNumber - 1}` : null,
      results
    },
    status: {
      code: 200,
      message: 'OK - served from local patrol cache'
    },
    cache: {
      source: true
    }
  };
}

function comparePatrols(left, right, sortBy) {
  const leftSerial = Number(left.serial_number || 0);
  const rightSerial = Number(right.serial_number || 0);
  const leftStart = getPatrolStartDate(left);
  const rightStart = getPatrolStartDate(right);

  if (sortBy === 'serial_number') return leftSerial - rightSerial;
  if (sortBy === 'start_time') return leftStart - rightStart || leftSerial - rightSerial;
  if (sortBy === '-start_time') return rightStart - leftStart || rightSerial - leftSerial;
  return rightSerial - leftSerial;
}

function getPatrolStartDate(patrol) {
  const segments = Array.isArray(patrol.patrol_segments) ? patrol.patrol_segments : [];
  const firstSegment = segments[0] || {};
  const value = firstSegment.time_range?.start_time || firstSegment.scheduled_start || patrol.start_time || patrol.updates?.[0]?.time;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}
