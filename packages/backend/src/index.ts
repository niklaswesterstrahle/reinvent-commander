// @reinvent-commander/backend
//
// Node + Fastify Local_Backend entry point. Phase 1 serves the built SPA and
// proxies the anonymous AWS Events REST catalog reads (ListEvents, GetEvent,
// ListSessions, GetSession) so the browser never calls AWS directly. The OAuth
// PKCE broker and token vault arrive in Phase 2.

import { SHARED_PACKAGE } from '@reinvent-commander/shared';

import { buildApp } from './server.js';

export const BACKEND_PACKAGE = '@reinvent-commander/backend' as const;

// Reserved loopback ports for the OAuth callback (design: Port Selection 8484-8489).
export const BACKEND_PORT_RANGE = [8484, 8485, 8486, 8487, 8488, 8489] as const;

export function describeBackend(): string {
  return `${BACKEND_PACKAGE} built on ${SHARED_PACKAGE}`;
}

export { buildApp } from './server.js';
export { EventsClient, EVENTS_API_BASE } from './upstream.js';
export { mapUpstreamError, UpstreamApiError } from './errors.js';

/**
 * Bind the first free port in {@link BACKEND_PORT_RANGE} (ascending) and start
 * the app. Exits with an actionable message if every reserved port is taken.
 */
export async function start(): Promise<{ port: number }> {
  for (const port of BACKEND_PORT_RANGE) {
    // Build the app per-port so the canonical OAuth redirect URI is derived
    // from the port this process actually binds.
    const app = buildApp({ boundPort: port });
    try {
      // Bind the documented `localhost` host so the OAuth callback is caught on
      // BOTH IPv4 (127.0.0.1) and IPv6 (::1): on a dual-stack machine the
      // browser may resolve `localhost` (the redirect_uri host) to ::1, and a
      // listener bound only to 127.0.0.1 would never receive the callback.
      await app.listen({ host: 'localhost', port });
      return { port };
    } catch (error) {
      await app.close().catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code === 'EADDRINUSE') continue;
      throw error;
    }
  }

  throw new Error(
    `No free port in ${BACKEND_PORT_RANGE.join(', ')}. Free one of these loopback ports and restart.`,
  );
}

// Start when run directly (not when imported by tests).
if (process.argv[1] && fileIsEntrypoint(process.argv[1])) {
  start()
    .then(({ port }) => {
      // Print the single same-origin URL to open. The SPA, /api, and the OAuth
      // callback all live here; a separate Vite dev server does not support
      // sign-in. No token or cookie material is logged.
      console.log(`re:Invent Commander ready at http://localhost:${port}/`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

function fileIsEntrypoint(argvPath: string): boolean {
  try {
    return import.meta.url === new URL(`file://${argvPath}`).href;
  } catch {
    return false;
  }
}
