// Serverless entrypoint for POST /api/score. Verifies the caller's Supabase
// session + the match token, recomputes points server-side, and writes the row
// via the service-role key (see _scoreHandler.js).
import { handleSubmitScore } from './_scoreHandler.js';

const bearer = (h) => (typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : undefined);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const authToken = bearer(req.headers.authorization);
    const result = await handleSubmitScore({ authToken, body }, process.env);
    res.status(200).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'score error' });
  }
}
