// Unit tests for the shared seat-cell display helper (design.md "Seat column
// display"). Covers all four precedence branches: a reservation overrides the
// catalog band (even "unavailable"/full), walkUp reads "walk-up", a reservable
// band shows itself with its palette class, and a non-reservable / band-less
// session shows the bare "--".

import { describe, expect, it } from 'vitest';
import type { SeatAvailability, Session } from '@reinvent-commander/shared';

import { seatDisplay, seatLabel } from './seat.js';

/** A minimal Session with the given reservability/band for the helper. */
function makeSession(
  overrides: Partial<Pick<Session, 'isReservable' | 'seatAvailability'>>,
): Session {
  return {
    sessionId: 'S1',
    title: 'A session',
    ...overrides,
  } as Session;
}

describe('seatDisplay', () => {
  it('1. reserved overrides the catalog band, even "unavailable"/full', () => {
    const full = makeSession({ isReservable: true, seatAvailability: 'unavailable' });
    expect(seatDisplay(full, true)).toEqual({ text: 'reserved', className: 'seat-reserved' });

    // It also overrides every other band and a non-reservable session.
    const walkUp = makeSession({ isReservable: true, seatAvailability: 'walkUp' });
    expect(seatDisplay(walkUp, true).text).toBe('reserved');
    const nonReservable = makeSession({ isReservable: false });
    expect(seatDisplay(nonReservable, true).text).toBe('reserved');
  });

  it('2. walkUp (not reserved) reads "walk-up", never a bare "--"', () => {
    const session = makeSession({ isReservable: true, seatAvailability: 'walkUp' });
    expect(seatDisplay(session, false)).toEqual({ text: 'walk-up', className: 'seat-walkUp' });
  });

  it('3. a reservable band shows the band text with its palette class', () => {
    const bands: SeatAvailability[] = ['available', 'limited', 'veryLimited', 'unavailable'];
    for (const band of bands) {
      const session = makeSession({ isReservable: true, seatAvailability: band });
      expect(seatDisplay(session, false)).toEqual({ text: band, className: `seat-${band}` });
    }
  });

  it('4. a non-reservable / band-less session is treated as walk-up', () => {
    // The live catalog represents walk-up as isReservable:false with no
    // seatAvailability (the walkUp enum value never appears), so these read
    // "walk-up" rather than a bare "--".
    const nonReservable = makeSession({ isReservable: false, seatAvailability: 'available' });
    expect(seatDisplay(nonReservable, false)).toEqual({ text: 'walk-up', className: 'seat-walkUp' });

    const noBand = makeSession({ isReservable: true });
    expect(seatDisplay(noBand, false)).toEqual({ text: 'walk-up', className: 'seat-walkUp' });

    const bare = makeSession({});
    expect(seatDisplay(bare, false)).toEqual({ text: 'walk-up', className: 'seat-walkUp' });
  });
});

describe('seatLabel', () => {
  it('returns the text of the derived seat display', () => {
    expect(seatLabel(makeSession({ isReservable: true, seatAvailability: 'limited' }), false)).toBe(
      'limited',
    );
    expect(
      seatLabel(makeSession({ isReservable: true, seatAvailability: 'unavailable' }), true),
    ).toBe('reserved');
    expect(seatLabel(makeSession({ isReservable: true, seatAvailability: 'walkUp' }), false)).toBe(
      'walk-up',
    );
    expect(seatLabel(makeSession({ isReservable: false }), false)).toBe('walk-up');
  });
});
