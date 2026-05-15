import { getSubjectTracks } from '../lib/earthranger.js';
import { getCachedPatrols } from '../lib/patrol-cache.js';
import { readTrack } from '../lib/track-store.js';

const trackCache = new Map();
const TTL_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const patrolId = req.query?.id;
    if (!patrolId) {
      return res.status(400).json({ error: 'id query param required' });
    }

    const stringId = String(patrolId);
    const cached = trackCache.get(stringId);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return res.status(200).json(cached.payload);
    }

    const cachedPatrols = await getCachedPatrols();
    const patrol = cachedPatrols.find(
      (p) => String(p.id) === stringId || String(p.serial_number) === stringId
    );
    if (!patrol) {
      return res.status(404).json({ error: 'Patrol not found in cache' });
    }

    const segments = Array.isArray(patrol.patrol_segments) ? patrol.patrol_segments : [];
    const segment = segments[0];
    if (!segment?.leader?.id) {
      return res.status(404).json({ error: 'Patrol has no GPS-tracked subject' });
    }

    const subjectId = segment.leader.id;
    const since = segment.time_range?.start_time;
    const until = segment.time_range?.end_time || new Date().toISOString();
    if (!since) {
      return res.status(400).json({ error: 'Patrol has no start time' });
    }

    const diskTrack = await readTrack(stringId);
    if (diskTrack) {
      const payload = {
        patrol_id: stringId,
        subject_id: segment.leader.id,
        subject_name: segment.leader.name || null,
        since,
        until,
        tracks: diskTrack,
        source: 'cache'
      };
      trackCache.set(stringId, { ts: Date.now(), payload });
      return res.status(200).json(payload);
    }

    const response = await getSubjectTracks(subjectId, since, until);
    const tracks = response?.data || response || null;

    const payload = {
      patrol_id: stringId,
      subject_id: subjectId,
      subject_name: segment.leader.name || null,
      since,
      until,
      tracks
    };

    trackCache.set(stringId, { ts: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
