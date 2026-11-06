// SPA re-auth-signal detection (cleanup pass).
//
// A pure predicate + reducer the shell uses to treat the backend's signed-out
// / 401 state as authoritative. When any `/api/*` call comes back with the
// backend's re-auth signal (HTTP 401, or the AuthenticationRequiredException /
// EventAuthRequiredException codes), the SPA must transition to signed-out
// immediately rather than trusting its last poll. Kept pure (no React, no
// window) so it is unit-testable in the web package's node vitest env.

import { ApiClientError } from '../api/client.js';

/**
 * Is `err` the backend's "you are signed out now, re-authenticate" signal?
 * True when it is an {@link ApiClientError} whose envelope is HTTP 401, or whose
 * code is `AuthenticationRequiredException` or `EventAuthRequiredException`
 * (the two re-auth codes the backend emits). Any other error — a 404/429/500,
 * a NetworkError, a plain `Error`, or a non-error value — is false.
 *
 * The signal is also detected when wrapped: the catalog walk fails pages with a
 * `CatalogWalkError` that carries the underlying `ApiClientError` in `.cause`,
 * so a 401 that 401s a walk page still transitions the SPA to signed-out. The
 * check recurses into a non-`ApiClientError` error's `.cause` to unwrap it.
 */
export function isReauthSignal(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    const { status, code } = err.apiError;
    return (
      status === 401 ||
      code === 'AuthenticationRequiredException' ||
      code === 'EventAuthRequiredException'
    );
  }
  // Unwrap one level of a wrapping error (e.g. CatalogWalkError.cause) so a
  // re-auth signal thrown underneath the catalog walk is still recognized.
  if (err instanceof Error && err.cause !== undefined && err.cause !== err) {
    return isReauthSignal(err.cause);
  }
  return false;
}

/** The minimal auth state this reducer carries. */
export interface AuthState {
  signedIn: boolean;
}

/**
 * Fold an error from an `/api/*` call into the auth state: a re-auth signal
 * forces `signedIn:false`; any other error (or a non-error) leaves the state
 * unchanged. This is the production path App.tsx runs in its catch blocks, so
 * the tested logic is the wired logic. A 401 from a catalog-walk page or a
 * GetSchedule call therefore drives the UI signed-out.
 */
export function nextAuthState(prev: AuthState, err: unknown): AuthState {
  return isReauthSignal(err) ? { signedIn: false } : prev;
}
