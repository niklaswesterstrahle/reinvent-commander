// Property test for the bounded Retry-After controller.
//
// Feature: reinvent-commander, Property 12: the retry controller never exceeds
// the retry cap, honors a valid non-negative integer Retry-After (default 5s
// when absent/invalid), and runs against a simulated clock so no real time
// passes.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { DEFAULT_RETRY_AFTER_SECONDS, MAX_THROTTLE_RETRIES, runWithRetry } from './retry.js';

const NUM_RUNS = 200;

/** A simulated clock: records each requested sleep instead of waiting. */
function simulatedClock() {
  const waits: number[] = [];
  let elapsedMs = 0;
  return {
    waits,
    get elapsedMs() {
      return elapsedMs;
    },
    sleep: async (ms: number) => {
      waits.push(ms);
      elapsedMs += ms;
    },
  };
}

/** The expected wait (ms) the controller derives from a raw Retry-After value. */
function expectedWaitMs(retryAfter: string | null | undefined): number {
  if (retryAfter != null && /^\d+$/.test(retryAfter.trim())) {
    return Number.parseInt(retryAfter.trim(), 10) * 1000;
  }
  return DEFAULT_RETRY_AFTER_SECONDS * 1000;
}

describe('Feature: reinvent-commander, Property 12', () => {
  it('never exceeds the retry cap and honors/defaults Retry-After on a simulated clock', async () => {
    await fc.assert(
      fc.asyncProperty(
        // How many attempts are throttled before success (or always throttled).
        fc.integer({ min: 0, max: MAX_THROTTLE_RETRIES + 3 }),
        // The Retry-After value each throttled attempt reports.
        fc.oneof(
          fc.integer({ min: 0, max: 120 }).map((n) => String(n)),
          fc.constant<string | null>(null),
          fc.constant<string>('bogus'),
          fc.constant<string>('-3'),
        ),
        async (throttledCount, retryAfter) => {
          const clock = simulatedClock();
          let calls = 0;

          const result = await runWithRetry(
            async (attemptIndex) => {
              calls += 1;
              const throttled = attemptIndex < throttledCount;
              return throttled ? { throttled: true, retryAfter } : { throttled: false };
            },
            { sleep: clock.sleep },
          );

          // At most maxRetries + 1 attempts, i.e. retries capped.
          expect(calls).toBeLessThanOrEqual(MAX_THROTTLE_RETRIES + 1);
          // One sleep per retry performed.
          expect(clock.waits.length).toBe(calls - 1);
          // Each wait matches the Retry-After policy.
          for (const wait of clock.waits) {
            expect(wait).toBe(expectedWaitMs(retryAfter));
          }
          // If success was reachable within the cap, it stops throttled=false.
          if (throttledCount <= MAX_THROTTLE_RETRIES) {
            expect(result.throttled).toBe(false);
          } else {
            expect(result.throttled).toBe(true);
            expect(calls).toBe(MAX_THROTTLE_RETRIES + 1);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
