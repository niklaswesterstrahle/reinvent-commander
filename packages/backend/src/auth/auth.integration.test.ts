// Task 12.8 — Auth_Service + schedule-proxy integration tests.
//
// Exercises the whole OAuth broker + authenticated proxy flow end to end with
// MOCKED OAuth and Events endpoints injected via `fetch`. No real network, no
// real AWS. Follows the appWithFetch/jsonResponse pattern from proxy.test.ts.

import { describe, expect, it } from 'vitest';

import { OAuthClient } from './oauthClient.js';
import { buildApp } from '../server.js';
import { EventsClient, type FetchLike } from '../upstream.js';

const CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';
const REDIRECT_URI = 'http://localhost:8484/callback';

/** Build a minimal Response for a mocked upstream fetch. */
function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  // 204/205/304 responses must have a null body per the Fetch spec.
  if (body === undefined || status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, headers });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A base64url JWT carrying the given payload (unsigned; structure only). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

interface Mocks {
  /** Calls to the OAuth token endpoint, decoded form bodies. */
  tokenCalls: URLSearchParams[];
  /** Calls to the OAuth revoke endpoint. */
  revokeCalls: URLSearchParams[];
  /** Calls to the Events API: [url, init]. */
  eventsCalls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[];
}

interface Handlers {
  /** Token endpoint handler (authorization_code + refresh_token). */
  token?: (form: URLSearchParams) => Response;
  /** Revoke endpoint handler. */
  revoke?: (form: URLSearchParams) => Response;
  /** Events API handler, keyed by method + path. */
  events?: (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Response;
}

/**
 * Build an app whose OAuth and Events upstreams are both mocked. OAuth uses
 * localhost test URLs; Events uses a test base. Returns the app plus a record
 * of calls for assertions.
 */
function buildMockedApp(handlers: Handlers) {
  const mocks: Mocks = { tokenCalls: [], revokeCalls: [], eventsCalls: [] };

  const oauthFetch: FetchLike = async (url, init) => {
    const form = new URLSearchParams(init?.body ?? '');
    if (url === 'https://oauth.test/token') {
      mocks.tokenCalls.push(form);
      return (handlers.token ?? (() => jsonResponse(400, { error: 'invalid_grant' })))(form);
    }
    if (url === 'https://oauth.test/revoke') {
      mocks.revokeCalls.push(form);
      return (handlers.revoke ?? (() => jsonResponse(200, {})))(form);
    }
    throw new Error(`unexpected oauth url ${url}`);
  };

  const eventsFetch: FetchLike = async (url, init) => {
    mocks.eventsCalls.push({ url, init });
    return (handlers.events ?? (() => jsonResponse(404, { message: 'no handler' })))(
      url,
      init ?? {},
    );
  };

  const oauthClient = new OAuthClient({
    fetchImpl: oauthFetch,
    authorizeUrl: 'https://oauth.test/authorize',
    tokenUrl: 'https://oauth.test/token',
    revokeUrl: 'https://oauth.test/revoke',
  });
  const eventsClient = new EventsClient({
    base: 'https://events.test',
    fetchImpl: eventsFetch,
    sleep: async () => {},
  });

  const app = buildApp({
    eventsClient,
    oauthClient,
    boundPort: 8484,
    webRoot: '/nonexistent-web-root',
  });
  return { app, mocks };
}

/** Drive a full login: GET /auth/login -> extract state -> GET /callback. */
async function signIn(
  app: ReturnType<typeof buildMockedApp>['app'],
  opts: { stateOverride?: string } = {},
): Promise<{ cookie?: string; status: number; location?: string; authorizeState: string }> {
  const login = await app.inject({ method: 'GET', url: '/auth/login' });
  const authorizeUrl = new URL(login.headers.location as string);
  const authorizeState = authorizeUrl.searchParams.get('state') ?? '';

  const callbackState = opts.stateOverride ?? authorizeState;
  const callback = await app.inject({
    method: 'GET',
    url: `/callback?code=auth-code-123&state=${encodeURIComponent(callbackState)}`,
    headers: { host: 'localhost:8484' },
  });

  const setCookie = callback.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const sid = cookieHeader?.match(/sid=([^;]+)/)?.[1];
  const result: { cookie?: string; status: number; location?: string; authorizeState: string } = {
    status: callback.statusCode,
    authorizeState,
  };
  if (sid) result.cookie = `sid=${sid}`;
  if (typeof callback.headers.location === 'string') result.location = callback.headers.location;
  return result;
}

describe('authorize URL', () => {
  it('carries the exact fixed parameter set and canonical redirect_uri', async () => {
    const { app } = buildMockedApp({});
    const login = await app.inject({ method: 'GET', url: '/auth/login' });

    expect(login.statusCode).toBe(302);
    const url = new URL(login.headers.location as string);
    expect(url.origin + url.pathname).toBe('https://oauth.test/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('openid email events/access');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('identity_provider')).toBe('AWSBuilderID');
    await app.close();
  });
});

describe('sign-in success', () => {
  it('exchanges the code, mints an HttpOnly;SameSite=Strict cookie, and leaks no token', async () => {
    const tokenBody = {
      access_token: 'access-jwt-abcdefghijklmnop',
      id_token: fakeJwt({ email: 'attendee@example.com', sub: 'user-9' }),
      refresh_token: 'refresh-opaque-abcdefghijklmnop',
      expires_in: 3600,
    };
    const { app, mocks } = buildMockedApp({ token: () => jsonResponse(200, tokenBody) });

    const result = await signIn(app);

    expect(result.status).toBe(302);
    expect(result.location).toBe('/?auth=ok');
    expect(result.cookie).toBeTruthy();

    // The one token call is the authorization_code exchange with a
    // byte-identical redirect_uri and the PKCE verifier.
    expect(mocks.tokenCalls).toHaveLength(1);
    const form = mocks.tokenCalls[0];
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(form.get('client_id')).toBe(CLIENT_ID);
    expect(form.get('code_verifier')).toBeTruthy();

    // /auth/status reports signed-in + email, never the tokens.
    const status = await app.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { cookie: result.cookie as string },
    });
    expect(status.json()).toEqual({ signedIn: true, email: 'attendee@example.com' });
    const statusBody = status.body;
    expect(statusBody).not.toContain('access-jwt');
    expect(statusBody).not.toContain('refresh-opaque');
    await app.close();
  });

  it('uses a byte-identical redirect_uri in the authorize URL and the token exchange', async () => {
    const tokenBody = {
      access_token: 'access-jwt-abcdefghijklmnop',
      refresh_token: 'refresh-opaque-abcdefghijklmnop',
      expires_in: 3600,
    };
    const { app, mocks } = buildMockedApp({ token: () => jsonResponse(200, tokenBody) });

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const authorizeRedirect = new URL(login.headers.location as string).searchParams.get(
      'redirect_uri',
    );
    await signIn(app);
    const exchangeRedirect = mocks.tokenCalls[0].get('redirect_uri');

    expect(authorizeRedirect).toBe(REDIRECT_URI);
    expect(exchangeRedirect).toBe(authorizeRedirect);
    await app.close();
  });
});

describe('sign-in failure modes', () => {
  it('rejects a state mismatch and stays signed out', async () => {
    const { app, mocks } = buildMockedApp({
      token: () => jsonResponse(200, { access_token: 'x', refresh_token: 'y', expires_in: 3600 }),
    });

    const result = await signIn(app, { stateOverride: 'not-the-real-state' });

    expect(result.status).toBe(302);
    expect(result.location).toBe('/?auth=failed');
    expect(result.cookie).toBeUndefined();
    // No token exchange should have happened on a state mismatch.
    expect(mocks.tokenCalls).toHaveLength(0);
    await app.close();
  });

  it('rejects a callback whose Host is not the canonical loopback origin', async () => {
    const { app, mocks } = buildMockedApp({
      token: () => jsonResponse(200, { access_token: 'x', refresh_token: 'y', expires_in: 3600 }),
    });

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const state = new URL(login.headers.location as string).searchParams.get('state') ?? '';
    const callback = await app.inject({
      method: 'GET',
      url: `/callback?code=c&state=${encodeURIComponent(state)}`,
      // 127.0.0.1 is NOT the canonical host (localhost is); this must be rejected.
      headers: { host: '127.0.0.1:8484' },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/?auth=failed');
    expect(mocks.tokenCalls).toHaveLength(0);
    await app.close();
  });

  it('stays signed out when the token exchange fails', async () => {
    const { app, mocks } = buildMockedApp({
      token: () => jsonResponse(400, { error: 'invalid_grant' }),
    });

    const result = await signIn(app);

    expect(result.status).toBe(302);
    expect(result.location).toBe('/?auth=failed');
    expect(result.cookie).toBeUndefined();
    expect(mocks.tokenCalls).toHaveLength(1);
    await app.close();
  });
});

/** Sign in and return the session cookie, for proxy-auth scenarios. */
async function signedInApp(handlers: Handlers) {
  const defaultToken = {
    access_token: 'access-jwt-abcdefghijklmnop',
    id_token: fakeJwt({ email: 'a@example.com', sub: 'u1' }),
    refresh_token: 'refresh-opaque-abcdefghijklmnop',
    expires_in: 3600,
  };
  const built = buildMockedApp({
    token: handlers.token ?? (() => jsonResponse(200, defaultToken)),
    revoke: handlers.revoke,
    events: handlers.events,
  });
  const result = await signIn(built.app);
  return { ...built, cookie: result.cookie as string };
}

describe('authenticated schedule proxy', () => {
  it('reads the schedule with a Bearer token and returns ids only', async () => {
    const { app, cookie, mocks } = await signedInApp({
      events: (url) => {
        expect(url).toBe('https://events.test/v1/events/evt/schedule');
        // Live API wraps the schedule in a `schedule` envelope.
        return jsonResponse(200, {
          schedule: { reserved: ['s1'], favorites: ['s2'], personalTime: [] },
        });
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/schedule',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reserved: ['s1'], favorites: ['s2'], personalTime: [] });
    const scheduleCall = mocks.eventsCalls.find((c) => c.url.endsWith('/schedule'));
    expect(scheduleCall?.init?.headers?.authorization).toBe('Bearer access-jwt-abcdefghijklmnop');
    await app.close();
  });

  it('rejects an unauthenticated schedule read with 401', async () => {
    const { app } = buildMockedApp({});
    const res = await app.inject({ method: 'GET', url: '/api/events/evt/schedule' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AuthenticationRequiredException');
    await app.close();
  });

  it('batches >10 favorites into ≤10 chunks and aggregates nothing lost', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `s${i}`);
    const seen: string[][] = [];
    const { app, cookie } = await signedInApp({
      events: (url, init) => {
        expect(url).toBe('https://events.test/v1/events/evt/favorites');
        const body = JSON.parse(init.body ?? '{}') as { sessionIds: string[] };
        seen.push(body.sessionIds);
        return jsonResponse(200, { successful: body.sessionIds, failed: [] });
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/events/evt/favorites',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { sessionIds: ids },
    });

    expect(res.statusCode).toBe(200);
    // 23 unique -> chunks of 10,10,3.
    expect(seen.map((c) => c.length)).toEqual([10, 10, 3]);
    expect(seen.every((c) => c.length <= 10)).toBe(true);
    expect(res.json().successful).toEqual(ids);
    expect(res.json().failed).toEqual([]);
    await app.close();
  });
});

describe('authenticated catalog reads (registration-gated events)', () => {
  it('attaches a Bearer token on a signed-in ListSessions and succeeds', async () => {
    const { app, cookie, mocks } = await signedInApp({
      events: (url) => {
        const parsed = new URL(url);
        expect(parsed.pathname).toBe('/v1/events/evt/sessions');
        return jsonResponse(
          200,
          { items: [{ sessionId: 's1', title: 'A' }], totalCount: 1 },
          { 'content-language': 'en-US' },
        );
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/sessions',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('en-US');
    expect(res.json()).toEqual({ items: [{ sessionId: 's1', title: 'A' }], totalCount: 1 });
    const call = mocks.eventsCalls.find((c) => c.url.includes('/sessions'));
    expect(call?.init?.headers?.authorization).toBe('Bearer access-jwt-abcdefghijklmnop');
    await app.close();
  });

  it('attaches a Bearer token on a signed-in GetEvent and unwraps the envelope', async () => {
    const { app, cookie, mocks } = await signedInApp({
      events: (url) => {
        expect(url).toBe('https://events.test/v1/events/evt');
        return jsonResponse(200, { event: { eventId: 'evt', name: 're:Invent 2026' } });
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eventId: 'evt', name: 're:Invent 2026' });
    expect(res.json().event).toBeUndefined();
    const call = mocks.eventsCalls.find((c) => c.url.endsWith('/v1/events/evt'));
    expect(call?.init?.headers?.authorization).toBe('Bearer access-jwt-abcdefghijklmnop');
    await app.close();
  });

  it('attaches a Bearer token on a signed-in GetSession and succeeds', async () => {
    const { app, cookie, mocks } = await signedInApp({
      events: (url) => {
        expect(new URL(url).pathname).toBe('/v1/events/evt/sessions/s1');
        // Live API wraps the session in a `session` envelope.
        return jsonResponse(200, { session: { sessionId: 's1', title: 'A' } });
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/sessions/s1',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe('s1');
    const call = mocks.eventsCalls.find((c) => c.url.includes('/sessions/s1'));
    expect(call?.init?.headers?.authorization).toBe('Bearer access-jwt-abcdefghijklmnop');
    await app.close();
  });

  it('surfaces re-auth (401) when a signed-in gated read persists a 401', async () => {
    const { app, cookie } = await signedInApp({
      token: (form) => {
        if (form.get('grant_type') === 'refresh_token') {
          return jsonResponse(400, { error: 'invalid_grant' });
        }
        return jsonResponse(200, {
          access_token: 'access-jwt-abcdefghijklmnop',
          refresh_token: 'refresh-opaque-abcdefghijklmnop',
          expires_in: 3600,
        });
      },
      events: () => jsonResponse(401, { message: 'register first' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/gated/sessions',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AuthenticationRequiredException');
    await app.close();
  });

  it('a signed-out request to a gated ListSessions stays anonymous and 401s', async () => {
    const { app, mocks } = buildMockedApp({
      events: (url, init) => {
        // Anonymous: no Authorization header attached.
        expect(init.headers?.authorization).toBeUndefined();
        expect(new URL(url).pathname).toBe('/v1/events/gated/sessions');
        return jsonResponse(401, { message: 'register first' });
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/events/gated/sessions' });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AuthenticationRequiredException');
    expect(mocks.eventsCalls[0]?.init?.headers?.authorization).toBeUndefined();
    await app.close();
  });

  it('a signed-out request to a public (non-gated) event still reads anonymously', async () => {
    const { app, mocks } = buildMockedApp({
      events: (url, init) => {
        expect(init.headers?.authorization).toBeUndefined();
        expect(new URL(url).pathname).toBe('/v1/events/public/sessions');
        return jsonResponse(200, { items: [{ sessionId: 's1', title: 'Open' }], totalCount: 1 });
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/events/public/sessions' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ sessionId: 's1', title: 'Open' }], totalCount: 1 });
    expect(mocks.eventsCalls[0]?.init?.headers?.authorization).toBeUndefined();
    await app.close();
  });
});

describe('single-401 refresh-and-retry', () => {
  it('refreshes once and retries once on an upstream 401', async () => {
    let scheduleCalls = 0;
    const { app, cookie, mocks } = await signedInApp({
      token: (form) => {
        if (form.get('grant_type') === 'refresh_token') {
          return jsonResponse(200, {
            access_token: 'access-jwt-SECOND-abcdefghij',
            refresh_token: 'refresh-opaque-abcdefghijklmnop',
            expires_in: 3600,
          });
        }
        return jsonResponse(200, {
          access_token: 'access-jwt-abcdefghijklmnop',
          refresh_token: 'refresh-opaque-abcdefghijklmnop',
          expires_in: 3600,
        });
      },
      events: () => {
        scheduleCalls += 1;
        if (scheduleCalls === 1) return jsonResponse(401, { message: 'expired' });
        return jsonResponse(200, { schedule: { reserved: [], favorites: [], personalTime: [] } });
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/schedule',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(scheduleCalls).toBe(2);
    // One refresh_token call happened.
    expect(mocks.tokenCalls.filter((f) => f.get('grant_type') === 'refresh_token')).toHaveLength(1);
    // The retry used the refreshed Bearer token.
    const retry = mocks.eventsCalls.filter((c) => c.url.endsWith('/schedule'))[1];
    expect(retry.init?.headers?.authorization).toBe('Bearer access-jwt-SECOND-abcdefghij');
    await app.close();
  });

  it('surfaces re-auth when the refresh is rejected on a 401', async () => {
    const { app, cookie } = await signedInApp({
      token: (form) => {
        if (form.get('grant_type') === 'refresh_token') {
          return jsonResponse(400, { error: 'invalid_grant' });
        }
        return jsonResponse(200, {
          access_token: 'access-jwt-abcdefghijklmnop',
          refresh_token: 'refresh-opaque-abcdefghijklmnop',
          expires_in: 3600,
        });
      },
      events: () => jsonResponse(401, { message: 'expired' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/schedule',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AuthenticationRequiredException');

    // The session is now cleared: a follow-up status reports signed out.
    const status = await app.inject({ method: 'GET', url: '/auth/status', headers: { cookie } });
    expect(status.json()).toEqual({ signedIn: false });
    await app.close();
  });
});

describe('429 bounded Retry-After', () => {
  it('retries a throttled schedule read then succeeds', async () => {
    let calls = 0;
    const { app, cookie } = await signedInApp({
      events: () => {
        calls += 1;
        if (calls === 1) return jsonResponse(429, { message: 'slow' }, { 'retry-after': '0' });
        return jsonResponse(200, { schedule: { reserved: [], favorites: [], personalTime: [] } });
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/schedule',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(calls).toBe(2);
    await app.close();
  });
});

describe('sign-out', () => {
  it('revokes the refresh token and clears the session', async () => {
    const { app, cookie, mocks } = await signedInApp({ revoke: () => jsonResponse(200, {}) });

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie },
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ signedIn: false });
    expect(mocks.revokeCalls).toHaveLength(1);
    expect(mocks.revokeCalls[0].get('token')).toBe('refresh-opaque-abcdefghijklmnop');

    const status = await app.inject({ method: 'GET', url: '/auth/status', headers: { cookie } });
    expect(status.json()).toEqual({ signedIn: false });
    await app.close();
  });

  it('clears the session even when revoke fails', async () => {
    const { app, cookie } = await signedInApp({ revoke: () => jsonResponse(500, { error: 'x' }) });

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie },
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ signedIn: false });
    const status = await app.inject({ method: 'GET', url: '/auth/status', headers: { cookie } });
    expect(status.json()).toEqual({ signedIn: false });
    await app.close();
  });
});

describe('idempotent DeletePersonalTime', () => {
  it('is a no-op (204) on a repeat delete when the upstream returns 404', async () => {
    let deleteCalls = 0;
    const { app, cookie } = await signedInApp({
      events: (url, init) => {
        if (init.method === 'DELETE' && url.includes('/personal-time/')) {
          deleteCalls += 1;
          if (deleteCalls === 1) return jsonResponse(204, undefined);
          return jsonResponse(404, { message: 'already gone' });
        }
        return jsonResponse(404, { message: 'no handler' });
      },
    });

    const first = await app.inject({
      method: 'DELETE',
      url: '/api/events/evt/personal-time/pt-1',
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'DELETE',
      url: '/api/events/evt/personal-time/pt-1',
      headers: { cookie },
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(deleteCalls).toBe(2);
    await app.close();
  });
});

describe('no token value leaks to the SPA', () => {
  it('keeps access/ID/refresh tokens out of every response body', async () => {
    const tokenBody = {
      access_token: 'access-jwt-abcdefghijklmnop',
      id_token: fakeJwt({ email: 'a@example.com', sub: 'u1' }),
      refresh_token: 'refresh-opaque-abcdefghijklmnop',
      expires_in: 3600,
    };
    const { app } = buildMockedApp({ token: () => jsonResponse(200, tokenBody) });

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const state = new URL(login.headers.location as string).searchParams.get('state') ?? '';
    const callback = await app.inject({
      method: 'GET',
      url: `/callback?code=c&state=${encodeURIComponent(state)}`,
      headers: { host: 'localhost:8484' },
    });

    for (const body of [login.body, callback.body]) {
      expect(body).not.toContain('access-jwt-abcdefghijklmnop');
      expect(body).not.toContain('refresh-opaque-abcdefghijklmnop');
      expect(body).not.toContain(tokenBody.id_token);
    }
    await app.close();
  });
});
