// @reinvent-commander/backend — authenticated schedule proxy (Task 12.6)
//
// Mounts the signed-in `/api/events/:eventId/...` schedule routes: read the
// schedule, add/remove favorites and reservations (bulk-batched ≤10 into one
// AggregatedBulkResult), and create/update/delete personal time. Each request
// resolves the opaque session cookie to a vault entry and derives a Bearer
// token via the vault (refreshing near expiry); a persistent 401 surfaces as a
// re-auth prompt. The SPA never sees token material.

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { PersonalTimeInput } from '@reinvent-commander/shared';

import { UpstreamApiError } from '../errors.js';
import { SESSION_COOKIE } from '../auth/authService.js';
import type { SessionStore } from '../auth/sessionStore.js';
import { ReauthRequired, type TokenVault } from '../auth/vault.js';
import { type AuthContext, EventsClient } from '../upstream.js';
import { runBatched } from './batch.js';

export interface ScheduleRoutesDeps {
  eventsClient: EventsClient;
  vault: TokenVault;
  sessions: SessionStore;
}

/**
 * Resolve a request's session cookie into an {@link AuthContext}, or `undefined`
 * when the request is not signed in. Shared by the authenticated schedule proxy
 * and the catalog reads so registration-gated events attach a Bearer token.
 */
export function authContextFor(
  request: FastifyRequest,
  sessions: SessionStore,
  vault: TokenVault,
): { sessionId: string; auth: AuthContext } | undefined {
  const sessionId = request.cookies?.[SESSION_COOKIE];
  if (!sessions.has(sessionId) || !vault.has(sessionId)) {
    return undefined;
  }
  const auth: AuthContext = {
    getToken: () => vault.getValidAccessToken(sessionId),
    refresh: async () => {
      try {
        return await vault.refreshSession(sessionId);
      } catch (error) {
        if (error instanceof ReauthRequired) {
          sessions.discard(sessionId);
          vault.discard(sessionId);
          return undefined;
        }
        throw error;
      }
    },
  };
  return { sessionId, auth };
}

interface EventIdParams {
  eventId: string;
}

interface ScheduleItemParams {
  eventId: string;
  sessionId: string;
}

interface PersonalTimeParams {
  eventId: string;
  personalTimeId: string;
}

/** Register the authenticated schedule proxy routes on `app`. */
export function registerScheduleRoutes(app: FastifyInstance, deps: ScheduleRoutesDeps): void {
  const { eventsClient, vault, sessions } = deps;

  /**
   * Resolve the request's session cookie into an {@link AuthContext}. Throws a
   * 401 AuthenticationRequiredException when the request is not signed in.
   */
  function requireAuthContext(request: FastifyRequest): { sessionId: string; auth: AuthContext } {
    const resolved = authContextFor(request, sessions, vault);
    if (!resolved) {
      throw new UpstreamApiError({
        status: 401,
        code: 'AuthenticationRequiredException',
        message: 'Sign in to manage your schedule.',
      });
    }
    return resolved;
  }

  /** Validate a bulk sessionIds body (1–10 enforced upstream; shape here). */
  function readSessionIds(body: unknown): string[] {
    const ids = (body as { sessionIds?: unknown })?.sessionIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new UpstreamApiError({
        status: 400,
        code: 'ValidationException',
        message: 'The request body must include a sessionIds string array.',
      });
    }
    return ids as string[];
  }

  // GET /api/events/:eventId/schedule
  app.get<{ Params: EventIdParams }>(
    '/api/events/:eventId/schedule',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      const schedule = await eventsClient.getSchedule(auth, request.params.eventId);
      return reply.send(schedule);
    },
  );

  // POST /api/events/:eventId/favorites
  app.post<{ Params: EventIdParams; Body: unknown }>(
    '/api/events/:eventId/favorites',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      const sessionIds = readSessionIds(request.body);
      const aggregated = await runBatched(sessionIds, (batch) =>
        eventsClient.associateFavorites(auth, request.params.eventId, batch),
      );
      return reply.send(aggregated);
    },
  );

  // DELETE /api/events/:eventId/favorites/:sessionId
  app.delete<{ Params: ScheduleItemParams }>(
    '/api/events/:eventId/favorites/:sessionId',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      await eventsClient.disassociateFavorite(
        auth,
        request.params.eventId,
        request.params.sessionId,
      );
      return reply.status(204).send();
    },
  );

  // POST /api/events/:eventId/reservations
  app.post<{ Params: EventIdParams; Body: unknown }>(
    '/api/events/:eventId/reservations',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      const sessionIds = readSessionIds(request.body);
      const aggregated = await runBatched(sessionIds, (batch) =>
        eventsClient.reserveSessions(auth, request.params.eventId, batch),
      );
      return reply.send(aggregated);
    },
  );

  // DELETE /api/events/:eventId/reservations/:sessionId
  app.delete<{ Params: ScheduleItemParams }>(
    '/api/events/:eventId/reservations/:sessionId',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      await eventsClient.cancelReservation(
        auth,
        request.params.eventId,
        request.params.sessionId,
      );
      return reply.status(204).send();
    },
  );

  // POST /api/events/:eventId/personal-time
  app.post<{ Params: EventIdParams; Body: PersonalTimeInput }>(
    '/api/events/:eventId/personal-time',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      await eventsClient.createPersonalTime(auth, request.params.eventId, request.body);
      return reply.status(204).send();
    },
  );

  // PUT /api/events/:eventId/personal-time/:personalTimeId
  app.put<{ Params: PersonalTimeParams; Body: PersonalTimeInput }>(
    '/api/events/:eventId/personal-time/:personalTimeId',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      await eventsClient.updatePersonalTime(
        auth,
        request.params.eventId,
        request.params.personalTimeId,
        request.body,
      );
      return reply.status(204).send();
    },
  );

  // DELETE /api/events/:eventId/personal-time/:personalTimeId (idempotent)
  app.delete<{ Params: PersonalTimeParams }>(
    '/api/events/:eventId/personal-time/:personalTimeId',
    async (request, reply) => {
      const { auth } = requireAuthContext(request);
      await eventsClient.deletePersonalTime(
        auth,
        request.params.eventId,
        request.params.personalTimeId,
      );
      return reply.status(204).send();
    },
  );
}
