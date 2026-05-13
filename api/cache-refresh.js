import { clearCache } from '../lib/patrol-cache.js';
import { runPatrolSync } from '../lib/patrol-sync.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const cleared = await clearCache();
    const sync = await runPatrolSync();
    return res.status(200).json({ cleared, sync });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
