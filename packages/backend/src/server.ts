// @reinvent-commander/backend — Fastify app (Phase 1, anonymous)
//
// Wires the four anonymous catalog proxy routes to the AWS Events REST API and
// serves the built React SPA for every non-/api route with an SPA fallback to
// index.html. No auth, no /auth routes, no token vault (Phase 2).

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuthService } from './auth/authService.js';
import { OAuthClient } from './auth/oauthClient.js';
import { SessionStore } from './auth/sessionStore.js';
import { TokenVault } from './auth/vault.js';
import { UpstreamApiError, transportError } from './errors.js';
import { parseBooleanParam, parseLocaleParam, parseNextTokenParam } from './params.js';
import { authContextFor, registerScheduleRoutes } from './proxy/scheduleRoutes.js';
import { EventsClient } from './upstream.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Default location of the built web SPA (packages/web/dist). */
export const DEFAULT_WEB_ROOT = resolve(here, '../../web/dist');

export interface BuildAppOptions {
  /** Injectable Events client so tests can mock the upstream. */
  eventsClient?: EventsClient;
  /** Absolute path to the built SPA. Static host is skipped if it is absent. */
  webRoot?: string;
  /**
   * The loopback port the backend bound. The canonical OAuth redirect URI is
   * derived from it (`http://localhost:<port>/callback`). Defaults to the first
   * reserved port when omitted (e.g. in tests that do not exercise the flow).
   */
  boundPort?: number;
  /** Injectable OAuth client so tests can mock the OAuth endpoints. */
  oauthClient?: OAuthClient;
  /** Injectable clock (epoch ms) threaded into the vault and Auth_Service. */
  clock?: () => number;
}

interface EventIdParams {
  eventId: string;
}

interface SessionParams {
  eventId: string;
  sessionId: string;
}

/**
 * Build (but do not start) the Fastify app. Routes resolve through the
 * injected or default {@link EventsClient}; errors are normalized to the
 * shared `ApiError` envelope by a single error handler.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const events = options.eventsClient ?? new EventsClient();
  const oauthClient = options.oauthClient ?? new OAuthClient();
  const clock = options.clock ?? Date.now;
  const boundPort = options.boundPort ?? 8484;

  const vault = new TokenVault({ oauthClient, clock });
  const sessions = new SessionStore();

  void app.register(fastifyCookie);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UpstreamApiError) {
      void reply.status(error.apiError.status).send(error.apiError);
      return;
    }
    void reply.status(502).send(transportError());
  });

  // Phase 2 — OAuth PKCE broker + authenticated schedule proxy.
  registerAuthService(app, { oauthClient, vault, sessions, boundPort, clock });
  registerScheduleRoutes(app, { eventsClient: events, vault, sessions });

  // GET /api/events -> { items: Event[] }
  app.get<{ Querystring: Record<string, unknown> }>('/api/events', async (request, reply) => {
    const includePast = parseBooleanParam('includePast', request.query.includePast);
    const items = await events.listEvents({ includePast });
    return reply.send({ items });
  });

  // GET /api/events/:eventId
  //
  // Signed-in requests attach a Bearer token (needed for registration-gated
  // events like re:Invent 2026); signed-out requests fall back to an anonymous
  // read so public, non-gated events still resolve.
  app.get<{ Params: EventIdParams }>('/api/events/:eventId', async (request, reply) => {
    const auth = authContextFor(request, sessions, vault)?.auth;
    const event = await events.getEvent(request.params.eventId, auth);
    return reply.send(event);
  });

  // GET /api/events/:eventId/sessions
  app.get<{ Params: EventIdParams; Querystring: Record<string, unknown> }>(
    '/api/events/:eventId/sessions',
    async (request, reply) => {
      const locale = parseLocaleParam(request.query.locale);
      const includeAbstracts = parseBooleanParam(
        'includeAbstracts',
        request.query.includeAbstracts,
      );
      const nextToken = parseNextTokenParam(request.query.nextToken);

      const auth = authContextFor(request, sessions, vault)?.auth;
      const result = await events.listSessions(
        request.params.eventId,
        {
          locale,
          includeAbstracts,
          nextToken,
        },
        auth,
      );

      if (result.contentLanguage) {
        void reply.header('content-language', result.contentLanguage);
      }

      const body: { items: typeof result.items; totalCount: number; nextToken?: string } = {
        items: result.items,
        totalCount: result.totalCount,
      };
      if (result.nextToken) body.nextToken = result.nextToken;
      return reply.send(body);
    },
  );

  // GET /api/events/:eventId/sessions/:sessionId
  app.get<{ Params: SessionParams; Querystring: Record<string, unknown> }>(
    '/api/events/:eventId/sessions/:sessionId',
    async (request, reply) => {
      const locale = parseLocaleParam(request.query.locale);
      const auth = authContextFor(request, sessions, vault)?.auth;
      const session = await events.getSession(
        request.params.eventId,
        request.params.sessionId,
        { locale },
        auth,
      );
      return reply.send(session);
    },
  );

  // Static SPA host + SPA fallback for non-/api routes. Only registered when
  // the built bundle exists so the backend still runs (API-only) before a web
  // build is produced.
  const webRoot = options.webRoot ?? DEFAULT_WEB_ROOT;
  if (existsSync(join(webRoot, 'index.html'))) {
    void app.register(fastifyStatic, { root: webRoot, wildcard: false });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({
        status: 404,
        code: 'NotFoundException',
        message: 'The requested resource was not found.',
      });
    });
  }

  return app;
}
