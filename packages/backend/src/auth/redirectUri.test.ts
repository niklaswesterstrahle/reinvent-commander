import { describe, expect, it } from 'vitest';

import {
  CALLBACK_PATH,
  REDIRECT_HOST,
  canonicalRedirectUri,
  isExactRedirectMatch,
} from './redirectUri.js';

describe('canonicalRedirectUri', () => {
  it('derives http://localhost:<port>/callback from the bound port', () => {
    expect(canonicalRedirectUri(8484)).toBe('http://localhost:8484/callback');
    expect(canonicalRedirectUri(8489)).toBe('http://localhost:8489/callback');
  });

  it('uses the documented loopback host localhost and the /callback path', () => {
    const uri = canonicalRedirectUri(8485);
    expect(uri).toContain(REDIRECT_HOST);
    expect(REDIRECT_HOST).toBe('localhost');
    expect(uri.endsWith(CALLBACK_PATH)).toBe(true);
  });

  it('rejects an invalid port', () => {
    expect(() => canonicalRedirectUri(0)).toThrow();
    expect(() => canonicalRedirectUri(-1)).toThrow();
    expect(() => canonicalRedirectUri(70000)).toThrow();
    expect(() => canonicalRedirectUri(8484.5)).toThrow();
  });
});

describe('isExactRedirectMatch', () => {
  const canonical = canonicalRedirectUri(8484);

  it('accepts a byte-identical redirect URI', () => {
    expect(isExactRedirectMatch('http://localhost:8484/callback', canonical)).toBe(true);
  });

  it('rejects host, port, scheme, or path mismatches', () => {
    expect(isExactRedirectMatch('http://127.0.0.1:8484/callback', canonical)).toBe(false);
    expect(isExactRedirectMatch('http://localhost:8485/callback', canonical)).toBe(false);
    expect(isExactRedirectMatch('https://localhost:8484/callback', canonical)).toBe(false);
    expect(isExactRedirectMatch('http://localhost:8484/callback/', canonical)).toBe(false);
    expect(isExactRedirectMatch('http://localhost:8484/cb', canonical)).toBe(false);
  });
});
