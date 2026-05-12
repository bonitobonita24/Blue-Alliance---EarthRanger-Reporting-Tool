import { createPatrol, getPatrols } from '../lib/earthranger.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { page_size = 25, since, until, patrol_type, status } = req.query;
      const patrols = await getPatrols({ page_size, since, until, patrol_type, status, sort_by: '-updated_at' });
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
