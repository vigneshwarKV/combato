import { useCallback, useEffect, useRef, useState } from 'react';

// One active room tab per browser. A room's authority (the host) and a joiner's
// identity are per-browser, so a SECOND tab of the same /room/:code would join as
// a ghost duplicate (host) or needlessly double up (joiner). Tabs of the same
// browser discover each other over a per-room BroadcastChannel: the first becomes
// 'active', every later tab resolves to 'duplicate' and must NOT connect.
//
// A reload keeps working because the reloading tab tears down its channel before
// the new instance pings — so nobody answers, and the new instance claims the
// room. Two DIFFERENT browsers have separate channels, so they remain independent
// participants (correct — they're different guests).
//
// Returns { status, peerRole, takeOver }:
//   status   — 'checking' briefly, then 'active' | 'duplicate' | 'released'.
//   peerRole — the role ('host' | 'joiner') of the tab that already holds the
//              room; only meaningful while 'duplicate'. Lets the UI offer a
//              takeover ONLY when it's safe (the holder is a joiner — taking over
//              a host would orphan the room, whose live state lives in that tab).
//   takeOver — seize the room from the current holder (which then goes 'released'
//              and disconnects). Intended for the joiner→joiner case only.
export function useSingleRoomTab(code, role = 'joiner') {
  // Very old WebView without BroadcastChannel: skip the guard, claim immediately.
  const supported = typeof BroadcastChannel !== 'undefined';
  const [status, setStatus] = useState(supported ? 'checking' : 'active');
  const [peerRole, setPeerRole] = useState(null);
  // A stable per-tab id so a tab never mistakes its own message for a rival's.
  const [id] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  // Mirror status/role into refs (via effects, not during render) so the message
  // handler reads current values without re-subscribing the channel.
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const roleRef = useRef(role);
  useEffect(() => { roleRef.current = role; }, [role]);
  const chRef = useRef(null);

  useEffect(() => {
    if (!code || !supported) return;

    const ch = new BroadcastChannel(`pk.tab.${code}`);
    chRef.current = ch;
    let settled = false;

    const onMessage = (e) => {
      const m = e.data;
      if (!m || m.id === id) return;
      if (m.type === 'PING') {
        // Only the tab holding the room answers — tells the newcomer it's taken,
        // and which role holds it (so the newcomer knows if takeover is safe).
        if (statusRef.current === 'active') ch.postMessage({ type: 'PONG', id, role: roleRef.current });
      } else if (m.type === 'PONG') {
        if (!settled) { settled = true; setPeerRole(m.role || null); setStatus('duplicate'); }
      } else if (m.type === 'TAKEOVER') {
        // Another tab seized the room — step aside if we currently hold it.
        if (statusRef.current === 'active') setStatus('released');
      }
    };
    ch.addEventListener('message', onMessage);
    ch.postMessage({ type: 'PING', id });

    // No answer within the window → this tab claims the room.
    const timer = setTimeout(() => {
      if (!settled) { settled = true; setStatus('active'); }
    }, 350);

    return () => {
      clearTimeout(timer);
      ch.removeEventListener('message', onMessage);
      ch.close();
      chRef.current = null;
    };
  }, [code, id, supported]);

  // Move the session to THIS tab: tell the holder to release, then claim the room.
  const takeOver = useCallback(() => {
    chRef.current?.postMessage({ type: 'TAKEOVER', id });
    setPeerRole(null);
    setStatus('active');
  }, [id]);

  return { status, peerRole, takeOver };
}
