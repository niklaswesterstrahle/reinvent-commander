// Property test for the token redactor.
//
// Feature: reinvent-commander, Property 14: after redaction, no token substring
// of length >= REDACTION_THRESHOLD survives — known token values and any
// JWT-shaped / long-opaque run are replaced by the fixed placeholder.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { REDACTED_PLACEHOLDER, REDACTION_THRESHOLD, redact } from './redact.js';

const NUM_RUNS = 200;

/** Token-shaped alphabet (base64url + JWT dot separator). */
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** An arbitrary token-shaped string at/above the redaction threshold. */
const tokenArb = fc
  .array(fc.constantFrom(...TOKEN_CHARS.split('')), {
    minLength: REDACTION_THRESHOLD,
    maxLength: 400,
  })
  .map((chars) => chars.join(''));

/** A short, non-token word that must survive redaction. */
const shortWordArb = fc
  .array(fc.constantFrom(...'abcdefghij'.split('')), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

describe('Feature: reinvent-commander, Property 14', () => {
  it('emits no token substring at or above the threshold', () => {
    fc.assert(
      fc.property(
        tokenArb,
        fc.array(fc.constantFrom(' ', ': ', ' Bearer ', '\n', ', '), { minLength: 1, maxLength: 4 }),
        (token, seps) => {
          const sep = seps.join('');
          const line = `log level=info${sep}token=${token}${sep}done`;

          const redacted = redact(line, [token]);

          // The exact token is gone.
          expect(redacted.includes(token)).toBe(false);
          // The placeholder is present.
          expect(redacted.includes(REDACTED_PLACEHOLDER)).toBe(true);
          // No surviving token-shaped run of threshold length remains.
          const run = new RegExp(`[A-Za-z0-9._~+/=-]{${REDACTION_THRESHOLD},}`);
          expect(run.test(redacted)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('redacts long runs even without a known-token list and keeps short words', () => {
    fc.assert(
      fc.property(tokenArb, shortWordArb, shortWordArb, (token, before, after) => {
        const line = `${before} ${token} ${after}`;
        const redacted = redact(line);

        expect(redacted.includes(token)).toBe(false);
        // Short non-token words are preserved.
        expect(redacted.includes(before)).toBe(true);
        expect(redacted.includes(after)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
