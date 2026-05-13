import { getSubjectTracks } from '../lib/earthranger.js';
import { getCachedPatrols } from '../lib/patrol-cache.js';

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

function extractCoordinates(data) {
  if (!data) return [];

  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    const coords = [];
    for (const feature of data.features) {
      const geom = feature.geometry;
      if (!geom?.coordinates) continue;
      if (geom.type === 'LineString') {
        coords.push(...geom.coordinates);
      } else if (geom.type === 'MultiLineString') {
        for (const line of geom.coordinates) coords.push(...line);
      } else if (geom.type === 'Point') {
        coords.push(geom.coordinates);
      }
    }
    return coords;
  }

  if (data.type === 'Feature' && data.geometry?.coordinates) {
    const geom = data.geometry;
    if (geom.type === 'LineString') return geom.coordinates;
    if (geom.type === 'MultiLineString') return geom.coordinates.flat();
  }

  if (Array.isArray(data.coordinates)) {
    return data.coordinates;
  }

  if (Array.isArray(data)) {
    return data.filter((p) => Array.isArray(p) && p.length >= 2);
  }

  return [];
}

function computeTrackDistance(coordinates) {
  let totalKm = 0;
  for (let i = 1; i < coordinates.length; i++) {
    totalKm += haversineKm(coordinates[i - 1], coordinates[i]);
  }
  return Math.round(totalKm * 100) / 100;
}

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
