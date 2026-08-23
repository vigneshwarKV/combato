// Realtime match transport. Replaces PeerJS/WebRTC (STUN-only, broken on
// symmetric NAT / carrier CGNAT) with a Supabase Realtime channel per room:
// Broadcast carries messages, Presence tracks join/leave. Works on every network
// with no TURN relay.
//
// This module keeps the SAME tiny API the match hooks already use
// (createPeer / sendMessage / broadcast / onMessage), so useMatchHost.js and
// useMatchClient.js are unchanged — only the pipe underneath is different:
//   • the host's peer.id IS the room code; joiners get a random peer id
//   • a "conn" is a virtual link to one other peer; sends are addressed envelopes
//     ({from, to, data}) broadcast on the shared channel and filtered by `to`
//   • Presence join → host fires 'connection'; Presence leave → conn 'close'
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';

const CHANNEL_PREFIX = 'room:';
const SUBSCRIBE_TIMEOUT_MS = 15000;

export function generateMatchCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generatePeerId() {
  return `pk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// A joiner's transport identity MUST be stable across a page refresh and a second
// tab, otherwise the host sees each reload as a brand-new fighter (new presence
// key → duplicate roster/bracket seat, and the old seat's REQUEST_MOVES go to a
// peerId nobody owns). We key it per room in localStorage — shared across this
// browser's tabs, surviving reloads — and only mint a new one when it's absent.
// The host doesn't use this (its id is the room code); joiners do.
export function stableJoinerId(code) {
  if (typeof window === 'undefined' || !code) return generatePeerId();
  const key = `pk.peerId.${code}`;
  try {
    let id = window.localStorage.getItem(key);
    if (!id) { id = generatePeerId(); window.localStorage.setItem(key, id); }
    return id;
  } catch {
    return generatePeerId();
  }
}

// Drop a room's stored joiner id when the player deliberately leaves / the room
// closes, so a later fresh join of the same code starts a clean identity.
export function forgetJoinerId(code) {
  if (typeof window === 'undefined' || !code) return;
  try { window.localStorage.removeItem(`pk.peerId.${code}`); } catch { /* ignore */ }
}

// One virtual connection to a single remote peer. Mimics a PeerJS DataConnection:
// `.peer`, `.on('open'|'close'|'error'|'data', cb)`, `.send(string)`.
class VirtualConn {
  constructor(peerId, peer) {
    this.peer = peerId;
    this._peer = peer;
    this._handlers = {};
    this._open = false;   // tracks open/close so a sync-driven reopen is idempotent
  }
  on(event, cb) { this._handlers[event] = cb; }
  _emit(event, arg) {
    if (event === 'open') this._open = true;
    else if (event === 'close') this._open = false;
    this._handlers[event]?.(arg);
  }
  send(str) { this._peer._sendEnvelope(this.peer, str); }
}

// Mimics a PeerJS Peer over a Supabase Realtime channel.
class RealtimePeer {
  constructor(id, isHost, hostEpoch = 0) {
    this.id = id;
    this.isHost = isHost;
    // Failover bookkeeping: hostEpoch rises each time hosting changes hands, and
    // instanceId uniquely identifies THIS peer (two hosts share id === code, so
    // instanceId is how they tell each other apart in presence).
    this._hostEpoch = hostEpoch;
    this._instanceId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this._handlers = {};        // 'connection' | 'error' | 'hostConflict' | 'hostBeat'
    this._channel = null;
    this._conns = new Map();    // remote peerId -> VirtualConn
    this._hostId = null;        // joiner only
    this._destroyed = false;
    this._hostBeatTimer = null;   // host: interval broadcasting "I'm the host"
    this._lastHostInstance = null; // joiner: which host instance we're joined to
    // The host's ADDRESS (what joiners send to) is always the room code, kept
    // separate from `id` (the presence key). For a normal host they're equal; for
    // a PROMOTED joiner the id stays its own peerId while the address becomes the
    // code — so it can host on its EXISTING channel without a fragile re-subscribe.
    this._hostAddr = null;
  }

  on(event, cb) { this._handlers[event] = cb; }

  // Our address on the wire: the room code when hosting, else our own id.
  _addr() { return this.isHost ? (this._hostAddr || this.id) : this.id; }

  // Promote a joiner peer to host IN PLACE — reuse the same channel (which already
  // sends AND receives fine) instead of removing + recreating one on the same room
  // topic (which strands the other joiners). Address becomes the room code.
  becomeHost(roomCode, hostEpoch) {
    this.isHost = true;
    this._hostAddr = roomCode;
    this._hostEpoch = hostEpoch || 0;
    this._hostId = null;
    this._lastHostInstance = null;
    for (const conn of this._conns.values()) conn._emit('close'); // drop old-host conn
    this._conns.clear();
    this._startHostBeat();
  }

  // ── Host heartbeat ──────────────────────────────────────────────────────────
  // Presence-key reuse (every host shares key === code) is unreliable for a
  // HANDOFF, so host liveness/identity rides an explicit broadcast instead: the
  // host beats every ~1.5s, and joiners/hosts react to that reliable signal.
  _startHostBeat() {
    if (!this.isHost || this._hostBeatTimer) return;
    const beat = () => this._channel?.send({
      type: 'broadcast', event: 'host',
      payload: { hostId: this._addr(), hostEpoch: this._hostEpoch, instanceId: this._instanceId },
    });
    beat(); // announce immediately
    this._hostBeatTimer = setInterval(beat, 1500);
  }

  _handleHostBeat(p) {
    if (!p || p.instanceId === this._instanceId) return; // ignore our own
    if (this.isHost) {
      // Another host is beating — split-brain. Step down if theirs outranks ours
      // (higher epoch, or equal epoch + smaller instanceId as a stable tiebreak).
      const otherEpoch = p.hostEpoch ?? 0;
      if (otherEpoch > this._hostEpoch ||
          (otherEpoch === this._hostEpoch && String(p.instanceId || '') < this._instanceId)) {
        this._handlers.hostConflict?.();
      }
      return;
    }
    // Joiner: our host is alive. Re-JOIN when the conn dropped OR when the host
    // INSTANCE changed (a successor took over — same id === code, different
    // instanceId). The instance check is key: it doesn't depend on a presence
    // 'leave' firing (which is exactly what's unreliable across a handoff).
    if (p.hostId === this._hostId) {
      const conn = this._conns.get(this._hostId);
      if (conn && (!conn._open || this._lastHostInstance !== p.instanceId)) {
        this._lastHostInstance = p.instanceId;
        conn._emit('open'); // (re-)JOIN the current host
      }
      this._handlers.hostBeat?.(p);
    }
  }

  _ensureConn(peerId) {
    let conn = this._conns.get(peerId);
    if (!conn) {
      conn = new VirtualConn(peerId, this);
      this._conns.set(peerId, conn);
      if (this.isHost) this._handlers.connection?.(conn); // fire before any data is delivered
    }
    return conn;
  }

  // All distinct peerIds currently present in the room (host + joiners). Used to
  // elect a successor host deterministically when the host leaves.
  presentPeerIds() {
    try {
      const state = this._channel?.presenceState?.() || {};
      const ids = new Set();
      for (const metas of Object.values(state)) {
        for (const m of metas || []) if (m?.peerId) ids.add(m.peerId);
      }
      return [...ids];
    } catch {
      return [];
    }
  }

  // How many live presences currently exist for a peerId. The same player with
  // two tabs/windows open shares ONE presence key (== their peerId) but tracks
  // a separate meta per window, so this returns >1 until the last one leaves.
  _presenceCount(peerId) {
    try {
      const state = this._channel?.presenceState?.() || {};
      const direct = state[peerId];
      if (Array.isArray(direct)) return direct.length;
      // Fallback: the presence key might differ from the peerId — scan metas.
      let n = 0;
      for (const metas of Object.values(state)) {
        for (const m of metas || []) if (m?.peerId === peerId) n++;
      }
      return n;
    } catch {
      return 0;
    }
  }

  // Announce our presence (peerId + host epoch/instance) on the channel.
  _track() {
    return this._channel?.track({ peerId: this.id, hostEpoch: this._hostEpoch, instanceId: this._instanceId });
  }

  // Update this host's epoch (hosting changed hands) and re-announce, then check
  // whether a better host now exists.
  setHostEpoch(epoch) {
    const e = Number.isFinite(epoch) ? epoch : 0;
    if (e === this._hostEpoch) return;
    this._hostEpoch = e;
    this._track();
    this._checkHostConflict();
  }

  // Two hosts can briefly coexist (an old host returns after a successor took
  // over, or a rare double-promotion). Both track under key === code, so compare
  // epochs: the higher epoch wins; ties break on instanceId. If a better host
  // exists, fire 'hostConflict' so this peer can step down.
  _checkHostConflict() {
    if (!this.isHost || !this._channel) return;
    const metas = (this._channel.presenceState?.() || {})[this.id] || [];
    for (const m of metas) {
      if (!m || m.instanceId === this._instanceId || m.peerId !== this.id) continue;
      const otherEpoch = m.hostEpoch ?? 0;
      if (otherEpoch > this._hostEpoch ||
          (otherEpoch === this._hostEpoch && String(m.instanceId || '') < this._instanceId)) {
        this._handlers.hostConflict?.();
        return;
      }
    }
  }

  // Attach and subscribe to the room channel. Resolves once SUBSCRIBED + presence
  // tracked. `onSelfOpen` lets the joiner fire its host-conn 'open'.
  _attach(code, onSelfOpen) {
    const channel = supabase.channel(CHANNEL_PREFIX + code, {
      config: { broadcast: { self: false }, presence: { key: this.id } },
    });
    this._channel = channel;

    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      const myAddr = this._addr();
      if (!payload || payload.from === myAddr) return;       // ignore our own
      if (payload.to && payload.to !== myAddr) return;       // not addressed to us
      let conn = this._conns.get(payload.from);
      if (!conn) {
        if (this.isHost) conn = this._ensureConn(payload.from); // fires 'connection' first
        else conn = this._conns.get(this._hostId);              // joiner: everything is the host
      }
      conn?._emit('data', payload.data);
    });

    // Host liveness/identity heartbeat (see _startHostBeat).
    channel.on('broadcast', { event: 'host' }, ({ payload }) => this._handleHostBeat(payload));

    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      for (const p of newPresences || []) {
        const pid = p?.peerId;
        if (!pid || pid === this.id) continue;
        if (this.isHost) {
          this._ensureConn(pid); // a joiner arrived
        } else if (pid === this._hostId) {
          // Joiner: the host reappeared (e.g. it refreshed). Reopen the SAME host
          // conn so useMatchClient re-sends JOIN and resyncs to the host's
          // (rehydrated) state.
          this._conns.get(this._hostId)?._emit('open');
        }
      }
      this._checkHostConflict(); // another host may have just appeared
    });
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const p of leftPresences || []) {
        const pid = p?.peerId;
        if (!pid) continue;
        // Multi-tab/window: one window closing fires 'leave' for its meta while
        // the others stay. Only tear down once the LAST presence is gone — else
        // closing one window evicts a player who is still connected elsewhere.
        if (this._presenceCount(pid) > 0) continue;
        const conn = this._conns.get(pid);
        if (!conn) continue;
        conn._emit('close');
        // Host: forget the departed peer. JOINER: keep the single host conn so a
        // returning host (a refresh) can reopen the SAME object — deleting it
        // would orphan the handlers useMatchClient registered on it.
        if (this.isHost) this._conns.delete(pid);
      }
    });

    // On (re)subscribe Supabase emits a full presence 'sync'. The host uses it to
    // (re)establish a connection to everyone ALREADY in the room — 'join' only
    // fires for members who arrive afterwards, so a host that reconnects/refreshes
    // would otherwise be blind to the joiners who never left.
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() || {};
      if (this.isHost) {
        for (const metas of Object.values(state)) {
          for (const m of metas || []) {
            const pid = m?.peerId;
            if (pid && pid !== this.id) this._ensureConn(pid);
          }
        }
        this._checkHostConflict(); // a rival host may be present in this sync
      } else if (this._hostId) {
        // Joiner: if the host is present but our conn is closed, (re)open it. This
        // covers a host handoff (old host out, new host in) that arrives as a sync
        // rather than a discrete join — otherwise we'd stay stranded.
        const present = Object.values(state).some(metas => (metas || []).some(m => m?.peerId === this._hostId));
        const conn = this._conns.get(this._hostId);
        if (present && conn && !conn._open) conn._emit('open');
      }
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const err = new Error('Realtime channel timed out');
        this._handlers.error?.(err);
        reject(err);
      }, SUBSCRIBE_TIMEOUT_MS);

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Fires on the first join AND on every auto-reconnect after a network
          // blip (Supabase rejoins the channel). Re-track presence and re-fire
          // onSelfOpen each time, so a joiner re-sends JOIN and the host re-acks
          // it — instead of sitting connected-but-forgotten after the drop.
          await this._track();
          if (this.isHost) this._startHostBeat(); // begin advertising as host
          onSelfOpen?.();
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const err = new Error(`Realtime channel ${status}`);
          this._handlers.error?.(err);
          reject(err);
        }
      });
    });
  }

  // Joiner: connect to a host's room. Returns the host conn immediately; it fires
  // 'open' once the channel is live.
  connect(hostId) {
    this._hostId = hostId;
    const conn = this._ensureConn(hostId);
    this._attach(hostId, () => conn._emit('open')).catch((e) => this._handlers.error?.(e));
    return conn;
  }

  _sendEnvelope(to, data) {
    if (!this._channel || this._destroyed) return;
    this._channel.send({ type: 'broadcast', event: 'msg', payload: { from: this._addr(), to, data } });
  }

  // Channel-wide (unaddressed) send — reaches EVERY peer on the room, including
  // ones we don't yet have a direct conn to. Used for lobby state so a peer that
  // hasn't (re-)JOINed a new host still sees the current roster/phase.
  _broadcastAll(data) {
    if (!this._channel || this._destroyed) return;
    this._channel.send({ type: 'broadcast', event: 'msg', payload: { from: this._addr(), to: null, data } });
  }

  destroy() {
    this._destroyed = true;
    clearInterval(this._hostBeatTimer);
    this._hostBeatTimer = null;
    if (this._channel) {
      try { supabase.removeChannel(this._channel); } catch { /* ignore */ }
      this._channel = null;
    }
    this._conns.clear();
  }
}

// Create a transport peer. With an id (the room code) → HOST: subscribes to the
// room immediately and resolves once live. Without → JOINER: resolves instantly;
// call peer.connect(hostCode) to join. Pass `opts.peerId` to give the joiner a
// STABLE identity (see stableJoinerId) so a refresh/second tab reconnects to the
// same seat rather than spawning a duplicate.
export function createPeer(id = null, opts = {}) {
  if (!isSupabaseConfigured) {
    return Promise.reject(new Error('Realtime unavailable — Supabase not configured'));
  }
  if (id) {
    const peer = new RealtimePeer(id, true);
    return peer._attach(id).then(() => peer);
  }
  return Promise.resolve(new RealtimePeer(opts.peerId || generatePeerId(), false));
}

// ── Message helpers (unchanged API) ─────────────────────────────────────────────

export function sendMessage(conn, type, payload = {}) {
  try {
    conn.send(JSON.stringify({ type, ...payload }));
  } catch (e) {
    console.warn('sendMessage failed:', e);
  }
}

export function broadcast(connections, type, payload = {}) {
  const msg = JSON.stringify({ type, ...payload });
  for (const conn of connections.values()) {
    try { conn.send(msg); } catch { /* ignore */ }
  }
}

// Channel-wide broadcast to EVERY peer on the room (not just ones we have a conn
// to). Used for lobby state during a host handoff.
export function broadcastAll(peer, type, payload = {}) {
  try { peer?._broadcastAll(JSON.stringify({ type, ...payload })); } catch { /* ignore */ }
}

export function onMessage(conn, handler) {
  conn.on('data', (raw) => {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      handler(msg);
    } catch { /* ignore malformed */ }
  });
}
