// @reinvent-commander/backend — canonical loopback redirect URI (Task 12.1)
//
// The OAuth loopback redirect URI must be captured ONCE at startup from the
// port the backend actually bound, and reused byte-identically in both the
// authorize request and the token exchange. The host is always `localhost`
// (never a bare `127.0.0.1`): `localhost` is the host the official AWS sign-in
// docs register and use in every example, and the browser lands the redirect
// on exactly this host string. The backend binds `localhost` so a dual-stack
// machine that resolves `localhost` to `::1` (IPv6) still catches the callback.
// The path is always `/callback`.

/** The fixed loopback host for the redirect URI (the documented `localhost`). */
export const REDIRECT_HOST = 'localhost';

/** The fixed callback path. */
export const CALLBACK_PATH = '/callback';

/**
 * Derive the canonical redirect URI `http://localhost:<port>/callback` from the
 * bound loopback port. This exact string is what both the authorize URL and the
 * token exchange must carry.
 */
export function canonicalRedirectUri(boundPort: number): string {
  if (!Number.isInteger(boundPort) || boundPort <= 0 || boundPort > 65535) {
    throw new Error(`Invalid bound port for redirect URI: ${String(boundPort)}`);
  }
  return `http://${REDIRECT_HOST}:${boundPort}${CALLBACK_PATH}`;
}

/**
 * Assert that an incoming request's effective redirect URI is an exact loopback
 * match for the canonical URI. The comparison is byte-identical: host, port,
 * scheme, and path must all match, with no query/hash/trailing differences.
 */
export function isExactRedirectMatch(candidate: string, canonical: string): boolean {
  return candidate === canonical;
}
