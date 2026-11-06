// Property test for the single-401 refresh-and-retry handler.
//
// Feature: reinvent-commander, Property 13: on a 401 the handler performs at
// most ONE refresh and ONE retry; a second 401 (or a failed refresh) stops and
// signals re-auth. A non-401 first response never triggers a refresh.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { sendWithRefreshOn401, type SendOutcome } from './refresh401.js';

const NUM_RUNS = 200;

describe('Feature: reinvent-commander, Property 13', () => {
  it('performs at most one refresh and one retry, then signals re-auth', async () => {
    await fc.assert(
      fc.asyncProperty(
        // The sequence of 401/not-401 outcomes the upstream would return.
        fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        // Whether a refresh (if attempted) succeeds.
        fc.boolean(),
        // Whether the refresh throws instead of returning.
        fc.boolean(),
        async (unauthorizedSeq, refreshSucceeds, refreshThrows) => {
          let sendCalls = 0;
          let refreshCalls = 0;

          const send = async (): Promise<SendOutcome<number>> => {
            const idx = sendCalls;
            sendCalls += 1;
            const unauthorized = unauthorizedSeq[idx] ?? false;
            return unauthorized ? { unauthorized: true } : { unauthorized: false, value: idx };
          };

          const refresh = async (): Promise<boolean> => {
            refreshCalls += 1;
            if (refreshThrows) throw new Error('refresh failed');
            return refreshSucceeds;
          };

          const result = await sendWithRefreshOn401(send, refresh);

          // Never more than one refresh.
          expect(refreshCalls).toBeLessThanOrEqual(1);
          // Never more than two sends (initial + one retry).
          expect(sendCalls).toBeLessThanOrEqual(2);

          const firstUnauthorized = unauthorizedSeq[0] ?? false;
          if (!firstUnauthorized) {
            // No 401 up front => no refresh, single send, ok.
            expect(refreshCalls).toBe(0);
            expect(sendCalls).toBe(1);
            expect(result.kind).toBe('ok');
          } else {
            // 401 => exactly one refresh attempt.
            expect(refreshCalls).toBe(1);
            if (!refreshSucceeds || refreshThrows) {
              // Failed refresh => no retry send, re-auth required.
              expect(sendCalls).toBe(1);
              expect(result.kind).toBe('reauthRequired');
            } else {
              // Refreshed => exactly one retry send.
              expect(sendCalls).toBe(2);
              const secondUnauthorized = unauthorizedSeq[1] ?? false;
              expect(result.kind).toBe(secondUnauthorized ? 'reauthRequired' : 'ok');
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
