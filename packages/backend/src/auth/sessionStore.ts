// @reinvent-commander/backend — opaque session-id store
//
// Maps an opaque 256-bit random cookie id to the presence of a vault entry.
// The cookie the browser holds is ONLY this opaque id; no token material is
// stored here. The id is minted on a successful token exchange and discarded
// on logout or re-auth.

import { randomBytes } from 'node:crypto';

/** Mint a fresh opaque session id with 256 bits of entropy (base64url). */
export function mintSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tracks which opaque session ids are live. The TokenVault holds the actual
 * token sets keyed by the same id; this set is the authority on whether a
 * cookie corresponds to a signed-in session.
 */
export class SessionStore {
  private readonly live = new Set<string>();

  /** Create and register a new session id. */
  create(): string {
    const id = mintSessionId();
    this.live.add(id);
    return id;
  }

  /** Whether the given cookie id corresponds to a live session. */
  has(sessionId: string | undefined): sessionId is string {
    return typeof sessionId === 'string' && this.live.has(sessionId);
  }

  /** Discard a session id (logout / re-auth). */
  discard(sessionId: string): void {
    this.live.delete(sessionId);
  }
}
