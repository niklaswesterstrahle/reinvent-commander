// Seat-availability display helpers shared by the panel rows and detail view.

import type { SeatAvailability, Session } from '@reinvent-commander/shared';

/** The CSS class that colors a seat band per the retro palette. */
export function seatClass(band?: SeatAvailability): string {
  return band ? `seat-${band}` : '';
}

/** The derived seat-cell text + CSS class for a session row or detail band. */
export interface SeatDisplay {
  text: string;
  className: string;
}

/**
 * Derive the seat-cell label for a session, resolved in this precedence
 * (documented in design.md "Seat column display"):
 *
 *   1. `isReserved` (the attendee holds this session) -> "reserved" in green.
 *      This OVERRIDES the catalog band even when it reports unavailable/full.
 *   2. `seatAvailability === 'walkUp'` -> "walk-up" (walk-up sessions take no
 *      reservation and must not show a bare "--").
 *   3. reservable with a band -> the band text with its palette color.
 *   4. otherwise -> "--".
 */
export function seatDisplay(session: Session, isReserved: boolean): SeatDisplay {
  if (isReserved) {
    return { text: 'reserved', className: 'seat-reserved' };
  }
  if (session.seatAvailability === 'walkUp') {
    return { text: 'walk-up', className: seatClass('walkUp') };
  }
  if (session.isReservable && session.seatAvailability) {
    return { text: session.seatAvailability, className: seatClass(session.seatAvailability) };
  }
  // A session that takes no reservation and carries no seat band is a walk-up:
  // the live catalog represents walk-up as `isReservable:false` with no
  // `seatAvailability` (the `walkUp` enum value does not actually appear in the
  // data), so "attend by walking up" is the correct label rather than a bare "--".
  return { text: 'walk-up', className: seatClass('walkUp') };
}

/** The seat-cell text alone, per {@link seatDisplay}'s precedence. */
export function seatLabel(session: Session, isReserved: boolean): string {
  return seatDisplay(session, isReserved).text;
}
