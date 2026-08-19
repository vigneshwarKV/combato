// Server-side Supabase session verification, shared by the API endpoints.
// Validates a Bearer access token (guest or Google) against Supabase's auth
// server and returns the user. Works regardless of the token's signing alg
// (Supabase issues ES256), so no local JWT secret is needed.
import { createClient } from '@supabase/supabase-js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export async function verifyUser(authToken, env) {
  const url = env.SUPABASE_URL || env.COMBATO_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.COMBATO_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw httpError(503, 'Supabase server env not configured');
  if (!authToken) throw httpError(401, 'missing auth token');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(authToken);
  if (error || !data?.user) throw httpError(401, 'invalid session');
  return data.user;
}
