import { describe, expect, it, vi } from 'vitest';

import { mapUpstreamError, parseRetryAfterSeconds } from './errors.js';
import { buildApp } from './server.js';
import { EventsClient, type FetchLike } from './upstream.js';

/** Build a minimal Response-like object for a mocked upstream fetch. */
function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Build an app whose upstream fetch is driven by the supplied handler. */
function appWithFetch(fetchImpl: FetchLike) {
  const client = new EventsClient({
    base: 'https://api.test',
    fetchImpl,
    // No real waits on retry.
    sleep: async () => {},
  });
  // webRoot points nowhere so the static host / SPA fallback stays off.
  return buildApp({ eventsClient: client, webRoot: '/nonexistent-web-root' });
}

describe('error mapping', () => {
  it('maps documented statuses to the ApiError envelope', () => {
    expect(mapUpstreamError(400).code).toBe('ValidationException');
    expect(mapUpstreamError(401).code).toBe('AuthenticationRequiredException');
    expect(mapUpstreamError(403).code).toBe('EventAuthRequiredException');
    expect(mapUpstreamError(404).code).toBe('NotFoundException');
    expect(mapUpstreamError(500).code).toBe('EventsServiceException');
    expect(mapUpstreamError(503).code).toBe('EventsUnavailableException');
  });

  it('maps a 401 to AuthenticationRequiredException with status 401', () => {
    const mapped = mapUpstreamError(401);
    expect(mapped).toMatchObject({ status: 401, code: 'AuthenticationRequiredException' });
    // An upstream-supplied code still wins.
    expect(mapUpstreamError(401, { __type: 'AuthenticationRequiredException' }).code).toBe(
      'AuthenticationRequiredException',
    );
  });

  it('prefers an upstream-supplied message and code', () => {
    const mapped = mapUpstreamError(400, { code: 'BadInput', message: 'nope' });
    expect(mapped).toMatchObject({ status: 400, code: 'BadInput', message: 'nope' });
  });

  it('attaches retryAfterSeconds on 429, honoring the header', () => {
    expect(mapUpstreamError(429, undefined, '12').retryAfterSeconds).toBe(12);
    expect(mapUpstreamError(429, undefined, 'bogus').retryAfterSeconds).toBe(5);
    expect(mapUpstreamError(429, undefined, null).retryAfterSeconds).toBe(5);
  });

  it('parses Retry-After defensively', () => {
    expect(parseRetryAfterSeconds('0')).toBe(0);
    expect(parseRetryAfterSeconds('-4')).toBe(5);
    expect(parseRetryAfterSeconds(undefined)).toBe(5);
  });
});

describe('GET /api/events', () => {
  it('forwards ListEvents and wraps items', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.test/v1/events');
      return jsonResponse(200, { items: [{ eventId: 'e1', name: 'Test' }] });
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ eventId: 'e1', name: 'Test' }] });
    await app.close();
  });

  it('passes includePast through when provided', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.test/v1/events?includePast=true');
      return jsonResponse(200, { items: [] });
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events?includePast=true' });

    expect(res.statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects a non-boolean includePast with 400', async () => {
    const fetchImpl = vi.fn();
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events?includePast=maybe' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ValidationException');
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('GET /api/events/:eventId', () => {
  it('forwards GetEvent', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.test/v1/events/evt-123');
      return jsonResponse(200, { eventId: 'evt-123', name: 'Thing' });
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/evt-123' });

    expect(res.statusCode).toBe(200);
    expect(res.json().eventId).toBe('evt-123');
    await app.close();
  });

  it('unwraps the live `{ event }` envelope to a bare Event', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { event: { eventId: 'reinvent2026', name: 're:Invent 2026' } }),
    );
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/reinvent2026' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eventId: 'reinvent2026', name: 're:Invent 2026' });
    expect(res.json().event).toBeUndefined();
    await app.close();
  });

  it('surfaces a 403 EventAuthRequiredException', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(403, { code: 'EventAuthRequiredException', message: 'register first' }),
    );
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/gated' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'EventAuthRequiredException', status: 403 });
    await app.close();
  });

  it('maps a 404 NotFound', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { message: 'no such event' }));
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/missing' });

    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('no such event');
    await app.close();
  });
});

describe('GET /api/events/:eventId/sessions', () => {
  it('passes only the allowed params and forwards Content-Language', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/v1/events/evt/sessions');
      expect(parsed.searchParams.get('locale')).toBe('en-US');
      expect(parsed.searchParams.get('includeAbstracts')).toBe('true');
      expect(parsed.searchParams.get('nextToken')).toBe('tok');
      // Unknown params must not be forwarded.
      expect(parsed.searchParams.get('search')).toBeNull();
      return jsonResponse(
        200,
        { items: [{ sessionId: 's1', title: 'A' }], totalCount: 1, nextToken: 'next' },
        { 'content-language': 'en-US' },
      );
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/sessions?locale=en-US&includeAbstracts=true&nextToken=tok&search=keynote',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('en-US');
    expect(res.json()).toEqual({
      items: [{ sessionId: 's1', title: 'A' }],
      totalCount: 1,
      nextToken: 'next',
    });
    await app.close();
  });

  it('defaults includeAbstracts to true when omitted', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('includeAbstracts')).toBe('true');
      return jsonResponse(200, { items: [], totalCount: 0 });
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/evt/sessions' });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects an invalid locale with 400', async () => {
    const fetchImpl = vi.fn();
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/sessions?locale=not%2Fvalid',
    });

    expect(res.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('retries a 429 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { message: 'slow down' }, { 'retry-after': '0' });
      return jsonResponse(200, { items: [], totalCount: 0 });
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/evt/sessions' });

    expect(res.statusCode).toBe(200);
    expect(calls).toBe(2);
    await app.close();
  });

  it('surfaces a bounded 429 after exhausting retries', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { message: 'still throttled' }, { 'retry-after': '0' }),
    );
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/evt/sessions' });

    expect(res.statusCode).toBe(429);
    expect(res.json().retryAfterSeconds).toBe(0);
    // 1 initial + 3 retries.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await app.close();
  });

  it('maps a 503 EventsUnavailableException', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, undefined));
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/evt/sessions' });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('EventsUnavailableException');
    await app.close();
  });
});

describe('GET /api/events/:eventId/sessions/:sessionId', () => {
  it('forwards GetSession with locale and encodes path segments', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/v1/events/evt/sessions/SES%20101');
      expect(parsed.searchParams.get('locale')).toBe('fr-FR');
      return jsonResponse(200, { sessionId: 'SES 101', title: 'Bonjour' });
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({
      method: 'GET',
      url: '/api/events/evt/sessions/SES%20101?locale=fr-FR',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe('SES 101');
    await app.close();
  });

  it('maps a transport failure to a 502 envelope', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const app = appWithFetch(fetchImpl as unknown as FetchLike);

    const res = await app.inject({ method: 'GET', url: '/api/events/evt/sessions/s1' });

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('UpstreamUnreachable');
    await app.close();
  });
});
