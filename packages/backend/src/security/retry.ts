// @reinvent-commander/backend — bounded Retry-After controller (Task 10.1)
//
// A pure, injectable controller for the throttling (429) retry policy. It
// honors a valid non-negative integer `Retry-After` (delay-seconds), falls
// back to the default wait when the header is absent/invalid, and caps the
// number of retries. The delay is performed through an injected `SleepLike` so
// tests incur no real wait and can run against a simulated clock.

import {
  DEFAULT_RETRY_AFTER_SECONDS,
  MAX_THROTTLE_RETRIES,
  parseRetryAfterSeconds,
} from '../errors.js';
import type { SleepLike } from '../upstream.js';

/** The outcome of one attempt, as seen by the retry controller. */
export interface AttemptResult {
  /** Whether this attempt was throttled (HTTP 429). */
  throttled: boolean;
  /** The raw `Retry-After` header value on a throttled attempt, if any. */
  retryAfter?: string | null;
}

export interface RetryControllerOptions {
  /** Injected delay; defaults to a real `setTimeout`-based sleep. */
  sleep?: SleepLike;
  /** Maximum number of retries after the first attempt. Defaults to 3. */
  maxRetries?: number;
}

/**
 * Run `attempt` with a bounded Retry-After retry policy. Calls `attempt` once,
 * then retries while it reports `throttled` — waiting the header-derived number
 * of seconds (default {@link DEFAULT_RETRY_AFTER_SECONDS}) between tries — until
 * it is no longer throttled or the retry cap is reached. Returns the final
 * {@link AttemptResult}. The total number of `attempt` calls never exceeds
 * `maxRetries + 1`, so the number of *retries* never exceeds `maxRetries`.
 */
export async function runWithRetry(
  attempt: (attemptIndex: number) => Promise<AttemptResult>,
  options: RetryControllerOptions = {},
): Promise<AttemptResult> {
  const sleep: SleepLike =
    options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? MAX_THROTTLE_RETRIES;

  let result = await attempt(0);
  for (let retry = 0; result.throttled && retry < maxRetries; retry += 1) {
    const waitSeconds = parseRetryAfterSeconds(result.retryAfter);
    await sleep(waitSeconds * 1000);
    result = await attempt(retry + 1);
  }
  return result;
}

export { DEFAULT_RETRY_AFTER_SECONDS, MAX_THROTTLE_RETRIES };
