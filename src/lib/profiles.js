// Server-side player profile (the leaderboard display name). Game data — charId,
// strategies — stays in localStorage; only the handle needs to live in Supabase
// so the board can show a name for each user_id.
import { supabase, isSupabaseConfigured } from './supabase.js';
import { getCurrentUser } from './auth.js';

// Upsert the signed-in user's handle into public.profiles. Best-effort: a no-op
// when Supabase is unconfigured or the user is signed out. RLS lets a user write
// ONLY their own row (auth.uid() = user_id), so this can't spoof someone else.
export async function upsertHandle(handle) {
  if (!isSupabaseConfigured || !handle) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const { error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: user.id, handle, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
  return user.id;
}

// The signed-in user's existing display handle from the server (or null). Used to
// restore a returning Google user's handle rather than overwriting it.
export async function getMyHandle() {
  if (!isSupabaseConfigured) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('handle').eq('user_id', user.id).maybeSingle();
  return data?.handle ?? null;
}
