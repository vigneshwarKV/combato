// Serverless entrypoint (Vercel-style `(req, res)` signature). The same
// handleAi() is reused by the Vite dev middleware so local dev and production
// share one implementation.
import { handleAi } from './_handler.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // req.body is parsed by the platform on Vercel; guard for the raw case.
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await handleAi(body);
    res.status(200).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'AI proxy error' });
  }
}
