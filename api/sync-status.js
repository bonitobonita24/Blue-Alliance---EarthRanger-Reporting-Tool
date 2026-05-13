import { getPatrolSyncStatus, runDeepSync } from '../lib/patrol-sync.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      return res.status(200).json(await runDeepSync());
    }

    if (req.method === 'GET') {
      return res.status(200).json(await getPatrolSyncStatus());
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
