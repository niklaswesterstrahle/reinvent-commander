// @reinvent-commander/backend — in-memory token vault (Task 12.3)
//
// Holds the per-session `TokenSet` entirely in memory and hands out a valid
// access token for upstream calls, transparently refreshing it when it is
// expired or within the near-expiry window. Only the access token is ever
// returned for upstream use; the refresh token leaves only via the OAuth
// token endpoint (inside OAuthClient). When a refresh is rejected (or the
// refresh token has reached its 30-day life), a typed `ReauthRequired` is
// thrown for the proxy to translate into a re-auth prompt.

import { REAUTH_REQUIRED_CODE, type TokenSet } from '@reinvent-commander/shared';

import type { OAuthClient, TokenResponse } from './oauthClient.js';

/** Refresh when the access token is expired or within this window of expiry. */
export const NEAR_EXPIRY_WINDOW_MS = 60_000;

/** Refresh-token (AWS Builder ID) maximum life: 30 days. */
export const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Injected clock (epoch ms) so tests control time deterministically. */
export type ClockLike = () => number;

/** Thrown when a session can no longer be refreshed and must re-authenticate. */
export class ReauthRequired extends Error {
  readonly code = REAUTH_REQUIRED_CODE;

  constructor(message = 'Your session has expired. Sign in again to continue.') {
    super(message);
    this.name = 'ReauthRequired';
  }
}

/** An internal vault entry: the token set plus when the refresh token was issued. */
interface VaultEntry {
  tokenSet: TokenSet;
  /** Epoch ms when the current refresh token was first issued (for 30-day life). */
  refreshTokenIssuedAt: number;
}

/**
 * Decode the payload of an ID JWT without verifying its signature beyond
 * structure. Returns the `email`/`sub` claims when present. A malformed token
 * yields empty claims rather than throwing.
 */
export function decodeIdTokenClaims(idToken: string | undefined): { email?: string; sub?: string } {
  if (!idToken) return {};
  const parts = idToken.split('.');
  if (parts.length !== 3) return {};
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const claims: { email?: string; sub?: string } = {};
    if (typeof payload.email === 'string') claims.email = payload.email;
    if (typeof payload.sub === 'string') claims.sub = payload.sub;
    return claims;
  } catch {
    return {};
  }
}

export interface TokenVaultOptions {
  oauthClient: OAuthClient;
  clock?: ClockLike;
}

export class TokenVault {
  private readonly entries = new Map<string, VaultEntry>();
  private readonly oauth: OAuthClient;
  private readonly clock: ClockLike;

  constructor(options: TokenVaultOptions) {
    this.oauth = options.oauthClient;
    this.clock = options.clock ?? Date.now;
  }

  /** Build a {@link TokenSet} from a fresh token-endpoint response. */
  tokenSetFromResponse(response: TokenResponse): TokenSet {
    return {
      accessToken: response.accessToken,
      accessTokenExpiresAt: this.clock() + response.expiresInSeconds * 1000,
      idTokenClaims: decodeIdTokenClaims(response.idToken),
      refreshToken: response.refreshToken,
    };
  }

  /** Store the token set for `sessionId`, replacing any prior entry. */
  put(sessionId: string, tokenSet: TokenSet): void {
    this.entries.set(sessionId, { tokenSet, refreshTokenIssuedAt: this.clock() });
  }

  /** Whether a token set exists for the session. */
  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  /** The server-held ID claims for the session, if any (never the raw tokens). */
  claims(sessionId: string): { email?: string; sub?: string } | undefined {
    return this.entries.get(sessionId)?.tokenSet.idTokenClaims;
  }

  /** The refresh token for the session (for revoke on logout), if any. */
  refreshToken(sessionId: string): string | undefined {
    return this.entries.get(sessionId)?.tokenSet.refreshToken;
  }

  /** Discard the session's token set. */
  discard(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  /**
   * Return a valid access token for `sessionId`, refreshing first when the
   * access token is expired or within {@link NEAR_EXPIRY_WINDOW_MS} of expiry.
   * Throws {@link ReauthRequired} if there is no entry, the refresh token has
   * reached its 30-day life, or the refresh is rejected.
   */
  async getValidAccessToken(sessionId: string): Promise<string> {
    const entry = this.entries.get(sessionId);
    if (!entry) throw new ReauthRequired();

    const now = this.clock();
    const needsRefresh = now >= entry.tokenSet.accessTokenExpiresAt - NEAR_EXPIRY_WINDOW_MS;
    if (!needsRefresh) return entry.tokenSet.accessToken;

    await this.refresh(sessionId, entry);
    return this.entries.get(sessionId)!.tokenSet.accessToken;
  }

  /**
   * Force a refresh of the session's access token. Throws {@link ReauthRequired}
   * when the refresh token is beyond its 30-day life or the refresh is rejected.
   * Used by the single-401 refresh-and-retry path.
   */
  async refreshSession(sessionId: string): Promise<string> {
    const entry = this.entries.get(sessionId);
    if (!entry) throw new ReauthRequired();
    await this.refresh(sessionId, entry);
    return this.entries.get(sessionId)!.tokenSet.accessToken;
  }

  private async refresh(sessionId: string, entry: VaultEntry): Promise<void> {
    const now = this.clock();
    if (now - entry.refreshTokenIssuedAt >= REFRESH_TOKEN_MAX_AGE_MS) {
      this.entries.delete(sessionId);
      throw new ReauthRequired();
    }

    const refreshed = await this.oauth.refreshToken(entry.tokenSet.refreshToken);
    if (!refreshed) {
      this.entries.delete(sessionId);
      throw new ReauthRequired();
    }

    const rotatedRefreshToken = refreshed.refreshToken !== entry.tokenSet.refreshToken;
    entry.tokenSet = {
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: now + refreshed.expiresInSeconds * 1000,
      idTokenClaims: refreshed.idToken
        ? decodeIdTokenClaims(refreshed.idToken)
        : entry.tokenSet.idTokenClaims,
      refreshToken: refreshed.refreshToken,
    };
    // Preserve the original 30-day clock unless the refresh token rotated.
    if (rotatedRefreshToken) entry.refreshTokenIssuedAt = now;
  }
}
