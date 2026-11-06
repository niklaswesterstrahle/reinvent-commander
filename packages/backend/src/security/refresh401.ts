// @reinvent-commander/backend — single-401 refresh-and-retry (Task 10.3)
//
// A pure controller over injected `send` and `refresh` callbacks, testable
// without Fastify. On an upstream 401 (AuthenticationRequiredException) it
// triggers AT MOST one token refresh and one retry; a second 401 stops and
// emits a re-auth signal. Non-401 outcomes pass straight through.

/** The outcome of one upstream send, as seen by the handler. */
export interface SendOutcome<T> {
  /** Whether the upstream responded 401 (authentication required). */
  unauthorized: boolean;
  /** The response payload when not unauthorized. */
  value?: T;
}

/** Discriminated result of the refresh-and-retry handler. */
export type Refresh401Result<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'reauthRequired' };

/**
 * Perform a request with a single refresh-and-retry on 401.
 *
 * Sequence:
 *   1. `send()` once.
 *   2. If not a 401, return `{ ok }` with the value.
 *   3. On a 401, call `refresh()` exactly once, then `send()` exactly once more.
 *   4. If the retry still 401s (or the refresh itself fails), return
 *      `{ reauthRequired }`.
 *
 * `refresh` returning `false` (or throwing) is treated as a failed refresh and
 * short-circuits to `{ reauthRequired }` without a second send.
 */
export async function sendWithRefreshOn401<T>(
  send: () => Promise<SendOutcome<T>>,
  refresh: () => Promise<boolean>,
): Promise<Refresh401Result<T>> {
  const first = await send();
  if (!first.unauthorized) {
    return { kind: 'ok', value: first.value as T };
  }

  let refreshed = false;
  try {
    refreshed = await refresh();
  } catch {
    refreshed = false;
  }
  if (!refreshed) {
    return { kind: 'reauthRequired' };
  }

  const second = await send();
  if (second.unauthorized) {
    return { kind: 'reauthRequired' };
  }
  return { kind: 'ok', value: second.value as T };
}
