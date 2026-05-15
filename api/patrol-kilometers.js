import { getSubjectTracks } from '../lib/earthranger.js';
import { getCachedPatrols } from '../lib/patrol-cache.js';
import { extractCoordinates, haversineKm } from '../lib/track-utils.js';

const kmCache = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { patrol_ids } = req.body || {};
    if (!Array.isArray(patrol_ids) || !patrol_ids.length) {
      return res.status(400).json({ error: 'patrol_ids array required' });
    }

    const cachedPatrols = await getCachedPatrols();
    const patrolMap = new Map();
    for (const patrol of cachedPatrols) {
      const key = patrol.id || patrol.serial_number;
      if (key) patrolMap.set(String(key), patrol);
    }

    const results = {};
    const fetchPromises = [];

    for (const id of patrol_ids) {
      const stringId = String(id);

      if (kmCache.has(stringId)) {
        results[stringId] = kmCache.get(stringId);
        continue;
      }

      const patrol = patrolMap.get(stringId);
      if (!patrol) continue;

      const segments = Array.isArray(patrol.patrol_segments) ? patrol.patrol_segments : [];
      const segment = segments[0];
      if (!segment?.leader?.id || !segment?.time_range?.start_time) continue;

      const subjectId = segment.leader.id;
      const since = segment.time_range.start_time;
      const until = segment.time_range.end_time || new Date().toISOString();

      fetchPromises.push(
        fetchTrackKilometers(subjectId, since, until)
          .then((km) => {
            results[stringId] = km;
            kmCache.set(stringId, km);
          })
          .catch(() => {
            results[stringId] = null;
          })
      );
    }

    await Promise.all(fetchPromises);
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function fetchTrackKilometers(subjectId, since, until) {
  const response = await getSubjectTracks(subjectId, since, until);
  const trackData = response?.data || response;
  const coordinates = extractCoordinates(trackData);
  if (!coordinates.length) return null;
  return computeTrackDistance(coordinates);
}

function computeTrackDistance(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) total += haversineKm(coordinates[i - 1], coordinates[i]);
  return Math.round(total * 100) / 100;
}
