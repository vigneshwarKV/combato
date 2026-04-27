import Peer from 'peerjs';

const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
};

export function generateMatchCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function createPeer(id = null) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, PEER_CONFIG) : new Peer(PEER_CONFIG);
    peer.on('open', () => resolve(peer));
    peer.on('error', reject);
    setTimeout(() => reject(new Error('Peer connection timeout')), 10000);
  });
}

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
    try { conn.send(msg); } catch {}
  }
}

export function onMessage(conn, handler) {
  conn.on('data', (raw) => {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      handler(msg);
    } catch {}
  });
}
