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

// One virtual connection to a single remote peer. Mimics a PeerJS DataConnection:
// `.peer`, `.on('open'|'close'|'error'|'data', cb)`, `.send(string)`.
class VirtualConn {
  constructor(peerId, peer) {
    this.peer = peerId;
    this._peer = peer;
    this._handlers = {};
  }
  on(event, cb) { this._handlers[event] = cb; }
  _emit(event, arg) { this._handlers[event]?.(arg); }
  send(str) { this._peer._sendEnvelope(this.peer, str); }
}

// Mimics a PeerJS Peer over a Supabase Realtime channel.
class RealtimePeer {
  constructor(id, isHost) {
    this.id = id;
    this.isHost = isHost;
    this._handlers = {};        // 'connection' | 'error'
    this._channel = null;
    this._conns = new Map();    // remote peerId -> VirtualConn
    this._hostId = null;        // joiner only
    this._destroyed = false;
  }

  on(event, cb) { this._handlers[event] = cb; }

  _ensureConn(peerId) {
    let conn = this._conns.get(peerId);
    if (!conn) {
      conn = new VirtualConn(peerId, this);
      this._conns.set(peerId, conn);
      if (this.isHost) this._handlers.connection?.(conn); // fire before any data is delivered
    }
    return conn;
  }

  // Attach and subscribe to the room channel. Resolves once SUBSCRIBED + presence
  // tracked. `onSelfOpen` lets the joiner fire its host-conn 'open'.
  _attach(code, onSelfOpen) {
    const channel = supabase.channel(CHANNEL_PREFIX + code, {
      config: { broadcast: { self: false }, presence: { key: this.id } },
    });
    this._channel = channel;

    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (!payload || payload.from === this.id) return;      // ignore our own
      if (payload.to && payload.to !== this.id) return;      // not addressed to us
      let conn = this._conns.get(payload.from);
      if (!conn) {
        if (this.isHost) conn = this._ensureConn(payload.from); // fires 'connection' first
        else conn = this._conns.get(this._hostId);              // joiner: everything is the host
      }
      conn?._emit('data', payload.data);
    });

    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      for (const p of newPresences || []) {
        const pid = p?.peerId;
        if (!pid || pid === this.id) continue;
        if (this.isHost) this._ensureConn(pid); // a joiner arrived
      }
    });
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const p of leftPresences || []) {
        const pid = p?.peerId;
        if (!pid) continue;
        const conn = this._conns.get(pid);
        if (conn) { conn._emit('close'); this._conns.delete(pid); }
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
          await channel.track({ peerId: this.id });
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          onSelfOpen?.();
          resolve();
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
    this._channel.send({ type: 'broadcast', event: 'msg', payload: { from: this.id, to, data } });
  }

  destroy() {
    this._destroyed = true;
    if (this._channel) {
      try { supabase.removeChannel(this._channel); } catch { /* ignore */ }
      this._channel = null;
    }
    this._conns.clear();
  }
}

// Create a transport peer. With an id (the room code) → HOST: subscribes to the
// room immediately and resolves once live. Without → JOINER: resolves instantly;
// call peer.connect(hostCode) to join.
export function createPeer(id = null) {
  if (!isSupabaseConfigured) {
    return Promise.reject(new Error('Realtime unavailable — Supabase not configured'));
  }
  if (id) {
    const peer = new RealtimePeer(id, true);
    return peer._attach(id).then(() => peer);
  }
  return Promise.resolve(new RealtimePeer(generatePeerId(), false));
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

export function onMessage(conn, handler) {
  conn.on('data', (raw) => {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      handler(msg);
    } catch { /* ignore malformed */ }
  });
}
