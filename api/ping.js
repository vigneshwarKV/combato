// Keep-warm cron target (see vercel.json "crons"). Supabase pauses free-tier
// projects after ~7 days idle; a daily trivial query keeps it active. Doubles as
// a lightweight health check.
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.COMBATO_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.COMBATO_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(503).json({ ok: false, error: 'supabase not configured' });
    return;
  }
  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // Cheapest possible touch — a head count on profiles keeps the DB warm.
    const { error } = await admin.from('profiles').select('user_id', { head: true, count: 'exact' }).limit(1);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
