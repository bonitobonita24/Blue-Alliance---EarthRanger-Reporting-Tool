import { aggregateAreaCovered } from '../lib/area-covered.js';
import { getCachedPatrols } from '../lib/patrol-cache.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const boundaries = Array.isArray(body.boundaries) ? body.boundaries : [];
    if (boundaries.length === 0) {
      return res.status(400).json({ error: 'boundaries required' });
    }

    let patrolIds = Array.isArray(body.patrolIds) ? body.patrolIds.map(String) : null;
    const patrolHoursById = {};
    const cached = await getCachedPatrols();

    if (!patrolIds) {
      patrolIds = filterPatrolsByRange(cached, body.from, body.to).map((p) => String(p.id));
    }

    for (const p of cached) {
      const seg = p?.patrol_segments?.[0];
      const start = seg?.time_range?.start_time;
      const end = seg?.time_range?.end_time;
      if (start && end) {
        const hrs = (Date.parse(end) - Date.parse(start)) / 3.6e6;
        if (Number.isFinite(hrs) && hrs > 0) patrolHoursById[String(p.id)] = hrs;
      }
    }

    const result = await aggregateAreaCovered({ patrolIds, boundaries, patrolHoursById });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function filterPatrolsByRange(patrols, fromIso, toIso) {
  if (!fromIso || !toIso) return patrols;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return patrols.filter((p) => {
    const start = Date.parse(p?.patrol_segments?.[0]?.time_range?.start_time);
    if (!Number.isFinite(start)) return false;
    return start >= from && start <= to;
  });
}
