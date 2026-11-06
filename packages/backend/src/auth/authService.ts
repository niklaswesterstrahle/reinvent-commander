// @reinvent-commander/backend — Auth_Service PKCE broker (Task 12.5)
//
// Registers the OAuth broker routes on the Fastify app:
//   GET  /auth/login   — mint a PKCE attempt, 302 to the authorize URL
//   GET  /callback     — validate redirect URI + state, exchange code, mint session
//   POST /auth/logout  — revoke the refresh token, clear session + cookie
//   GET  /auth/status  — { signedIn, email? } from server-held ID claims
//
// The attendee's browser only ever holds an opaque HttpOnly;SameSite=Strict
// cookie; no access/ID/refresh token crosses the trust boundary. Pending PKCE
// attempts are held in a short-TTL in-memory map keyed by `state` and discarded
// after the token exchange (success or failure).

import type { FastifyInstance } from 'fastify';

import { generatePkce } from '../security/pkce.js';
import type { OAuthClient } from './oauthClient.js';
import { canonicalRedirectUri, isExactRedirectMatch } from './redirectUri.js';
import { SessionStore } from './sessionStore.js';
import type { TokenVault } from './vault.js';

/** Name of the opaque session cookie. */
export const SESSION_COOKIE = 'sid';

/** Short TTL for a pending PKCE attempt (ms). */
export const PENDING_ATTEMPT_TTL_MS = 10 * 60_000;

/** Path the browser lands on after a sign-in attempt (success or failure). */
export const APP_REDIRECT_PATH = '/';

/** Injected clock (epoch ms) for pending-attempt TTL. */
export type ClockLike = () => number;

interface PendingAttempt {
  verifier: string;
  createdAt: number;
}

export interface AuthServiceDeps {
  oauthClient: OAuthClient;
  vault: TokenVault;
  sessions: SessionStore;
  /** The port the backend bound; the canonical redirect URI is derived from it. */
  boundPort: number;
  clock?: ClockLike;
}

/**
 * Register the Auth_Service routes on `app`. Returns nothing; the shared
 * `vault` and `sessions` are the source of truth for schedule-proxy auth.
 */
export function registerAuthService(app: FastifyInstance, deps: AuthServiceDeps): void {
  const { oauthClient, vault, sessions } = deps;
  const clock = deps.clock ?? Date.now;
  const redirectUri = canonicalRedirectUri(deps.boundPort);
  const pending = new Map<string, PendingAttempt>();

  function prune(now: number): void {
    for (const [state, attempt] of pending) {
      if (now - attempt.createdAt >= PENDING_ATTEMPT_TTL_MS) pending.delete(state);
    }
  }

  // GET /auth/login — start a fresh PKCE attempt and redirect to authorize.
  app.get('/auth/login', async (_request, reply) => {
    const now = clock();
    prune(now);
    const attempt = generatePkce();
    pending.set(attempt.state, { verifier: attempt.verifier, createdAt: now });

    const authorizeUrl = oauthClient.buildAuthorizeUrl({
      redirectUri,
      codeChallenge: attempt.challenge,
      state: attempt.state,
    });
    return reply.redirect(authorizeUrl, 302);
  });

  // GET /callback?code&state — complete the exchange and mint a session.
  app.get<{ Querystring: Record<string, unknown> }>('/callback', async (request, reply) => {
    const now = clock();
    prune(now);

    // (a) The request's own resolved redirect URI must be the exact canonical
    // loopback URI at /callback. The Host header carries `localhost:<port>` for
    // a genuine loopback request (the browser lands on the redirect_uri host
    // verbatim); anything else (missing/altered host, wrong path) fails the
    // byte-identical match.
    const host = request.headers.host ?? '';
    const path = request.url.split('?')[0];
    const requestRedirectUri = `http://${host}${path}`;
    if (!isExactRedirectMatch(requestRedirectUri, redirectUri)) {
      return reply.redirect(`${APP_REDIRECT_PATH}?auth=failed`, 302);
    }

    const code = singleParam(request.query.code);
    const state = singleParam(request.query.state);

    // (b) State must match a stored pending attempt.
    const attempt = state ? pending.get(state) : undefined;
    if (state) pending.delete(state);
    if (!code || !state || !attempt) {
      return reply.redirect(`${APP_REDIRECT_PATH}?auth=failed`, 302);
    }

    // (c) Exchange the code for tokens using the stored verifier and the
    // byte-identical redirect URI.
    const tokens = await oauthClient.exchangeAuthorizationCode({
      code,
      redirectUri,
      codeVerifier: attempt.verifier,
    });
    if (!tokens) {
      return reply.redirect(`${APP_REDIRECT_PATH}?auth=failed`, 302);
    }

    const sessionId = sessions.create();
    vault.put(sessionId, vault.tokenSetFromResponse(tokens));

    void reply.setCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: false,
    });
    return reply.redirect(`${APP_REDIRECT_PATH}?auth=ok`, 302);
  });

  // POST /auth/logout — revoke, then clear the session unconditionally.
  app.post('/auth/logout', async (request, reply) => {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (sessions.has(sessionId)) {
      const refreshToken = vault.refreshToken(sessionId);
      if (refreshToken) {
        // Best-effort revoke; clear local state even if it fails.
        await oauthClient.revokeToken(refreshToken).catch(() => false);
      }
      vault.discard(sessionId);
      sessions.discard(sessionId);
    }
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ signedIn: false });
  });

  // GET /auth/status — signed-in flag + email from server-held ID claims.
  app.get('/auth/status', async (request, reply) => {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (!sessions.has(sessionId) || !vault.has(sessionId)) {
      return reply.send({ signedIn: false });
    }
    const claims = vault.claims(sessionId);
    const body: { signedIn: boolean; email?: string } = { signedIn: true };
    if (claims?.email) body.email = claims.email;
    return reply.send(body);
  });
}

/** Read a single string value from a possibly-array query field. */
function singleParam(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}
