import crypto from 'node:crypto';

const RSVP_SYNC_VERSION = 'v1';
const RSVP_SYNC_TTL_SECONDS = 60 * 60;

function base64UrlEncode(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getSyncSecret() {
  return (process.env.RSVP_SYNC_JWT_SECRET || process.env.NEXTAUTH_SECRET || '').trim();
}

function signPayload(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function isRsvpSyncSigningConfigured() {
  return Boolean(getSyncSecret());
}

export function createRsvpSyncToken(userId, now = new Date()) {
  const secret = getSyncSecret();
  if (!secret) throw new Error('RSVP sync signing secret is not configured');
  if (!userId) throw new Error('userId is required');

  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + RSVP_SYNC_TTL_SECONDS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const userPart = base64UrlEncode(userId);
  const payload = [RSVP_SYNC_VERSION, issuedAt, expiresAt, nonce, userPart].join('.');
  const signature = signPayload(payload, secret);
  return {
    token: `${payload}.${signature}`,
    expiresAt,
  };
}

export function verifyRsvpSyncToken(token, now = new Date()) {
  const secret = getSyncSecret();
  if (!token || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== RSVP_SYNC_VERSION) return null;

  const [version, issuedAtRaw, expiresAtRaw, nonce, userPart, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);
  const nowSec = Math.floor(now.getTime() / 1000);

  if (
    !Number.isInteger(issuedAt)
    || !Number.isInteger(expiresAt)
    || issuedAt <= 0
    || expiresAt <= issuedAt
    || expiresAt < nowSec
  ) {
    return null;
  }

  let userId;
  try {
    userId = base64UrlDecode(userPart);
  } catch {
    return null;
  }

  if (!userId || !/^[a-zA-Z0-9@._+-]+$/.test(userId)) return null;

  const payload = [version, issuedAtRaw, expiresAtRaw, nonce, userPart].join('.');
  const expected = signPayload(payload, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  return { userId, expiresAt };
}