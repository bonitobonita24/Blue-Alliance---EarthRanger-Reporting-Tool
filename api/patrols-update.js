import { updatePatrol } from '../lib/earthranger.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { patrol_id } = req.query;
  if (!patrol_id) return res.status(400).json({ error: 'Missing patrol_id query parameter' });

  try {
    const updated = await updatePatrol(patrol_id, req.body || {});
    return res.status(200).json(updated);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
