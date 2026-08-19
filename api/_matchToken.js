// Signed, single-use match tokens (Layer B). /api/match-start issues one when a
// match begins; /api/score requires it. HMAC-signed so the client can't forge or
// tamper, and it carries the server's start timestamp + a nonce, so a score can
// only be redeemed once and only after a realistic match duration has elapsed.
//
// Format is a mini-JWT: base64url(payload) "." base64url(HMAC-SHA256(payload)).
import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signMatchToken(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyMatchToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) throw new Error('malformed match token');
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad match token signature');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

export const randomNonce = () => crypto.randomBytes(16).toString('hex');
