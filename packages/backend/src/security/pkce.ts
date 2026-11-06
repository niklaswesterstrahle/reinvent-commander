// @reinvent-commander/backend — PKCE generation (Task 10.7)
//
// Generates the per-attempt PKCE material for the OAuth 2.0 Authorization Code
// + PKCE (S256) flow against AWS Builder ID: a fresh high-entropy verifier of
// 43–128 unreserved characters, a fresh random `state` (>= 128 bits,
// base64url), and the code challenge = unpadded base64url(SHA256(verifier)).
// Uses node:crypto only.

import { createHash, randomBytes } from 'node:crypto';

/** Minimum verifier length per RFC 7636 (43 unreserved chars). */
export const MIN_VERIFIER_LENGTH = 43;

/** Maximum verifier length per RFC 7636 (128 unreserved chars). */
export const MAX_VERIFIER_LENGTH = 128;

/**
 * The PKCE unreserved character set per RFC 7636:
 * `A–Z a–z 0–9 - . _ ~` (66 characters).
 */
const UNRESERVED =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** The PKCE material for one authorization attempt. */
export interface PkceAttempt {
  /** 43–128 unreserved characters, fresh per attempt. */
  verifier: string;
  /** `S256` code challenge: unpadded base64url(SHA256(verifier)). */
  challenge: string;
  /** The code-challenge method; always `S256`. */
  challengeMethod: 'S256';
  /** Random anti-CSRF state, >= 128 bits of entropy, base64url. */
  state: string;
}

/** Encode a buffer as unpadded base64url. */
export function base64UrlEncode(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a code verifier of `length` unreserved characters (default 64,
 * within the 43–128 range). Each character is drawn uniformly without modulo
 * bias by rejecting bytes that fall outside a whole number of alphabet spans.
 */
export function generateVerifier(length = 64): string {
  const n = Math.max(MIN_VERIFIER_LENGTH, Math.min(MAX_VERIFIER_LENGTH, Math.floor(length)));
  const chars = UNRESERVED;
  const maxUnbiased = Math.floor(256 / chars.length) * chars.length;
  let out = '';
  while (out.length < n) {
    const bytes = randomBytes(n - out.length);
    for (const byte of bytes) {
      if (byte < maxUnbiased) out += chars[byte % chars.length];
      if (out.length === n) break;
    }
  }
  return out;
}

/** Compute the `S256` challenge for a verifier: unpadded base64url(SHA256). */
export function challengeFromVerifier(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier, 'ascii').digest());
}

/** Generate a fresh random `state` with at least 128 bits of entropy (base64url). */
export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

/**
 * Generate a fresh PKCE attempt: verifier, S256 challenge, and random state.
 * `verifierLength` defaults to 64 and is clamped into the 43–128 range.
 */
export function generatePkce(verifierLength = 64): PkceAttempt {
  const verifier = generateVerifier(verifierLength);
  return {
    verifier,
    challenge: challengeFromVerifier(verifier),
    challengeMethod: 'S256',
    state: generateState(),
  };
}
