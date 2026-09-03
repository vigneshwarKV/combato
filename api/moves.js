// Serverless entrypoint (Vercel-style `(req, res)` signature). The same
// handleAi() is reused by the Vite dev middleware so local dev and production
// share one implementation.
import process from 'node:process';
import { handleAi } from './_handler.js';

const bearer = (h) => (typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : undefined);

export default async function handler(req, res) {
  // CORS. The native app (Capacitor) calls this cross-origin from
  // capacitor://localhost / https://localhost.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // req.body is parsed by the platform on Vercel; guard for the raw case.
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const authToken = bearer(req.headers.authorization);
    const result = await handleAi(body, process.env, authToken);
    res.status(200).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Move service error' });
  }
}
