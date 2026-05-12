import { testConnection } from '../lib/earthranger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = await testConnection();
    return res.status(200).json({
      ok: true,
      earthrangerReachable: true,
      subjectCount: payload?.count ?? null,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      earthrangerReachable: false,
      error: error.message,
      checkedAt: new Date().toISOString()
    });
  }
}
