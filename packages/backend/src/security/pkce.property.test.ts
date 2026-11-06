// Property test for PKCE generation.
//
// Feature: reinvent-commander, Property 15: the verifier is 43–128 unreserved
// characters, the challenge is verifiably unpadded base64url(SHA256(verifier)),
// the state carries >= 128 bits of entropy as base64url, and every attempt is
// fresh.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  MAX_VERIFIER_LENGTH,
  MIN_VERIFIER_LENGTH,
  challengeFromVerifier,
  generatePkce,
} from './pkce.js';

const NUM_RUNS = 200;

/** The PKCE unreserved character set per RFC 7636. */
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;
/** Unpadded base64url. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Independently compute the expected S256 challenge. */
function expectedChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('Feature: reinvent-commander, Property 15', () => {
  it('produces a valid verifier, S256 challenge, and random state each attempt', () => {
    fc.assert(
      fc.property(
        // Requested verifier length, including out-of-range values to confirm clamping.
        fc.integer({ min: 10, max: 200 }),
        (requestedLength) => {
          const a = generatePkce(requestedLength);

          // Verifier: 43–128 unreserved chars.
          expect(a.verifier.length).toBeGreaterThanOrEqual(MIN_VERIFIER_LENGTH);
          expect(a.verifier.length).toBeLessThanOrEqual(MAX_VERIFIER_LENGTH);
          expect(UNRESERVED.test(a.verifier)).toBe(true);

          // Challenge: unpadded base64url(SHA256(verifier)) with S256 method.
          expect(a.challengeMethod).toBe('S256');
          expect(BASE64URL.test(a.challenge)).toBe(true);
          expect(a.challenge.includes('=')).toBe(false);
          expect(a.challenge).toBe(expectedChallenge(a.verifier));
          expect(challengeFromVerifier(a.verifier)).toBe(a.challenge);

          // State: base64url, >= 128 bits of entropy (16 bytes => >= 22 b64url chars).
          expect(BASE64URL.test(a.state)).toBe(true);
          expect(a.state.length).toBeGreaterThanOrEqual(22);

          // Freshness: a second attempt differs in verifier and state.
          const b = generatePkce(requestedLength);
          expect(b.verifier).not.toBe(a.verifier);
          expect(b.state).not.toBe(a.state);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
