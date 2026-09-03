// Serverless entrypoint for POST /api/delete-account. Deletes the caller's guest
// (anonymous) account — used when a guest upgrades to a Google account that
// already exists (see _scoreHandler.handleDeleteAccount).
import process from 'node:process';
import { handleDeleteAccount } from './_scoreHandler.js';

const bearer = (h) => (typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : undefined);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const authToken = bearer(req.headers.authorization);
    const result = await handleDeleteAccount({ authToken }, process.env);
    res.status(200).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'delete error' });
  }
}
