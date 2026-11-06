// SPA auth-state polling (Task 14.3).
//
// A tiny poller over GET /auth/status that lets the shell react to sign-in and
// sign-out without the SPA ever holding token material. It calls the backend
// on a fixed interval and reports the latest { signedIn, email? } to a
// listener; a failed poll is treated as "signed out" so the F2 prompt is shown
// rather than a stale signed-in view. Both the fetcher and the interval are
// injectable so the logic can be unit-tested without a browser or real timers.

import type { AuthStatusResponse } from '@reinvent-commander/shared';
import { getAuthStatus } from '../api/client.js';

/** The signed-out fallback used on launch and whenever a poll fails. */
export const SIGNED_OUT: AuthStatusResponse = { signedIn: false };

/** Default poll cadence; auth state changes are rare, so this is conservative. */
export const AUTH_POLL_INTERVAL_MS = 15_000;

export interface AuthStatusPollerOptions {
  /** Status fetcher; defaults to the real GET /auth/status client call. */
  fetchStatus?: () => Promise<AuthStatusResponse>;
  /** Poll cadence in ms; defaults to {@link AUTH_POLL_INTERVAL_MS}. */
  intervalMs?: number;
}

/** A started poller; call {@link AuthStatusPoller.stop} to cancel. */
export interface AuthStatusPoller {
  /** Force an immediate poll (e.g. right after returning from the OAuth redirect). */
  refresh(): Promise<AuthStatusResponse>;
  /** Stop the interval; safe to call more than once. */
  stop(): void;
}

/**
 * Normalize an arbitrary status payload into a safe {@link AuthStatusResponse}.
 * Anything that is not an explicit `{ signedIn: true }` collapses to signed
 * out, so a malformed or partial body never leaves the UI falsely signed in.
 */
function normalizeStatus(value: AuthStatusResponse | undefined | null): AuthStatusResponse {
  if (!value || value.signedIn !== true) return SIGNED_OUT;
  return value.email !== undefined
    ? { signedIn: true, email: value.email }
    : { signedIn: true };
}

/**
 * Poll GET /auth/status on an interval, reporting each result to `onStatus`.
 * The first poll runs immediately. A thrown/failed poll reports
 * {@link SIGNED_OUT} rather than propagating, so the shell can always fall back
 * to the F2 sign-in prompt.
 */
export function startAuthStatusPoller(
  onStatus: (status: AuthStatusResponse) => void,
  options: AuthStatusPollerOptions = {},
): AuthStatusPoller {
  const { fetchStatus = getAuthStatus, intervalMs = AUTH_POLL_INTERVAL_MS } = options;
  let stopped = false;

  async function poll(): Promise<AuthStatusResponse> {
    let status: AuthStatusResponse;
    try {
      status = normalizeStatus(await fetchStatus());
    } catch {
      status = SIGNED_OUT;
    }
    if (!stopped) onStatus(status);
    return status;
  }

  void poll();
  const handle = setInterval(() => void poll(), intervalMs);

  return {
    refresh: poll,
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
