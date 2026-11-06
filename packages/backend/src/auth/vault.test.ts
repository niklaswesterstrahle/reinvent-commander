import { describe, expect, it, vi } from 'vitest';

import type { OAuthClient, TokenResponse } from './oauthClient.js';
import {
  NEAR_EXPIRY_WINDOW_MS,
  REFRESH_TOKEN_MAX_AGE_MS,
  ReauthRequired,
  TokenVault,
  decodeIdTokenClaims,
} from './vault.js';

/** Build a minimal OAuthClient stub exposing only refreshToken. */
function stubOAuth(refreshToken: OAuthClient['refreshToken']): OAuthClient {
  return { refreshToken } as unknown as OAuthClient;
}

/** A base64url JWT with the given payload (unsigned; structure only). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('decodeIdTokenClaims', () => {
  it('extracts email and sub from a JWT payload', () => {
    const token = fakeJwt({ email: 'a@example.com', sub: 'user-1', other: 'x' });
    expect(decodeIdTokenClaims(token)).toEqual({ email: 'a@example.com', sub: 'user-1' });
  });

  it('returns empty claims for malformed input', () => {
    expect(decodeIdTokenClaims(undefined)).toEqual({});
    expect(decodeIdTokenClaims('not-a-jwt')).toEqual({});
    expect(decodeIdTokenClaims('a.b')).toEqual({});
  });
});

describe('TokenVault near-expiry refresh', () => {
  it('returns the stored access token when not near expiry', async () => {
    let now = 1_000_000;
    const refreshToken = vi.fn();
    const vault = new TokenVault({ oauthClient: stubOAuth(refreshToken), clock: () => now });
    vault.put('sid', {
      accessToken: 'access-1',
      accessTokenExpiresAt: now + 10 * 60_000,
      idTokenClaims: {},
      refreshToken: 'refresh-1',
    });

    const token = await vault.getValidAccessToken('sid');

    expect(token).toBe('access-1');
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('refreshes when within 60s of expiry', async () => {
    let now = 1_000_000;
    const refreshToken = vi.fn(
      async (): Promise<TokenResponse> => ({
        accessToken: 'access-2',
        refreshToken: 'refresh-1',
        expiresInSeconds: 3600,
      }),
    );
    const vault = new TokenVault({ oauthClient: stubOAuth(refreshToken), clock: () => now });
    vault.put('sid', {
      accessToken: 'access-1',
      // Exactly at the near-expiry threshold => should refresh.
      accessTokenExpiresAt: now + NEAR_EXPIRY_WINDOW_MS,
      idTokenClaims: {},
      refreshToken: 'refresh-1',
    });

    const token = await vault.getValidAccessToken('sid');

    expect(token).toBe('access-2');
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(refreshToken).toHaveBeenCalledWith('refresh-1');
  });

  it('does not refresh just outside the near-expiry window', async () => {
    let now = 1_000_000;
    const refreshToken = vi.fn();
    const vault = new TokenVault({ oauthClient: stubOAuth(refreshToken), clock: () => now });
    vault.put('sid', {
      accessToken: 'access-1',
      accessTokenExpiresAt: now + NEAR_EXPIRY_WINDOW_MS + 1,
      idTokenClaims: {},
      refreshToken: 'refresh-1',
    });

    await vault.getValidAccessToken('sid');

    expect(refreshToken).not.toHaveBeenCalled();
  });
});

describe('TokenVault ReauthRequired', () => {
  it('throws when there is no entry for the session', async () => {
    const vault = new TokenVault({ oauthClient: stubOAuth(vi.fn()) });
    await expect(vault.getValidAccessToken('missing')).rejects.toBeInstanceOf(ReauthRequired);
  });

  it('throws and discards the session when the refresh is rejected', async () => {
    let now = 1_000_000;
    const refreshToken = vi.fn(async (): Promise<TokenResponse | undefined> => undefined);
    const vault = new TokenVault({ oauthClient: stubOAuth(refreshToken), clock: () => now });
    vault.put('sid', {
      accessToken: 'access-1',
      accessTokenExpiresAt: now - 1,
      idTokenClaims: {},
      refreshToken: 'refresh-1',
    });

    await expect(vault.getValidAccessToken('sid')).rejects.toBeInstanceOf(ReauthRequired);
    expect(vault.has('sid')).toBe(false);
  });

  it('throws when the refresh token has reached its 30-day life', async () => {
    let now = 1_000_000;
    const refreshToken = vi.fn();
    const vault = new TokenVault({ oauthClient: stubOAuth(refreshToken), clock: () => now });
    vault.put('sid', {
      accessToken: 'access-1',
      accessTokenExpiresAt: now - 1,
      idTokenClaims: {},
      refreshToken: 'refresh-1',
    });

    // Advance past the 30-day refresh-token life.
    now += REFRESH_TOKEN_MAX_AGE_MS;

    await expect(vault.getValidAccessToken('sid')).rejects.toBeInstanceOf(ReauthRequired);
    expect(refreshToken).not.toHaveBeenCalled();
    expect(vault.has('sid')).toBe(false);
  });
});
