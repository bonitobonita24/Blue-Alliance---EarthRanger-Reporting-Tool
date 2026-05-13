import { runDeepSync } from '../lib/patrol-sync.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const status = await runDeepSync();
    return res.status(200).json({ sync: status?.lastDeepSync || {}, cache: status?.cache || {} });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
