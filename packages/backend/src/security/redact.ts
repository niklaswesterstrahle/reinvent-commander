// @reinvent-commander/backend — token redactor (Task 10.5)
//
// All backend log output passes through this redactor so no token substring is
// ever emitted. It replaces any known access/ID/refresh token value AND any
// JWT-shaped or long-opaque substring at/above the redaction threshold with a
// fixed placeholder. The guarantee is that the redacted text contains no
// token-like substring of length >= REDACTION_THRESHOLD.

/**
 * Minimum length at which an opaque/JWT-shaped substring is treated as a token
 * and redacted. Tokens (access/ID JWTs, opaque refresh tokens) are far longer
 * than this; ordinary log words are shorter.
 */
export const REDACTION_THRESHOLD = 20;

/** The fixed placeholder emitted in place of any redacted token value. */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * A run of token-shaped characters: base64url / JWT alphabet plus the dot that
 * separates JWT segments. A maximal run of these of length >=
 * {@link REDACTION_THRESHOLD} is redacted.
 */
const TOKEN_RUN = new RegExp(`[A-Za-z0-9._~+/=-]{${REDACTION_THRESHOLD},}`, 'g');

/** Escape a string for use as a literal inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact token material from a line of log text.
 *
 * Known token values (the access/ID/refresh tokens for the current session)
 * are redacted first by exact match, then any remaining JWT-shaped or
 * long-opaque run at/above the threshold is redacted. The result never
 * contains a token-shaped substring of length >= {@link REDACTION_THRESHOLD}.
 */
export function redact(text: string, knownTokens: readonly string[] = []): string {
  let out = text;

  // Redact exact known token values first (covers tokens that might contain a
  // character outside the generic run alphabet, or that sit adjacent to one).
  for (const token of knownTokens) {
    if (typeof token === 'string' && token.length >= REDACTION_THRESHOLD) {
      out = out.replace(new RegExp(escapeRegExp(token), 'g'), REDACTED_PLACEHOLDER);
    }
  }

  // Redact any remaining long token-shaped run.
  out = out.replace(TOKEN_RUN, REDACTED_PLACEHOLDER);
  return out;
}
