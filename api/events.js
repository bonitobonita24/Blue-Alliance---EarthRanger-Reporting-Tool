import { getEvents } from '../lib/earthranger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { page_size = 25, updated_since, sort_by = '-updated_at' } = req.query;

  try {
    const payload = await getEvents({ page_size, updated_since, sort_by });
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
