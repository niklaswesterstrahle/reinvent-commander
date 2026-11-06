// Session detail view (task 15.1).
//
// An overlay showing a session's title, abbreviation, type, level, venue, room,
// speakers, and sessionTime (date/time/duration/timezone), plus a seat band for
// reservable sessions using the retro seat-availability colors. When the list
// item lacks an abstract (e.g. a cache built without abstracts), the abstract
// is fetched on demand via GetSession with a loading indication; a fetch
// failure shows an error in the abstract area while all other details stay
// visible.

import { useEffect, useState } from 'react';
import type { Session } from '@reinvent-commander/shared';
import { getSession } from '../api/client.js';
import { ApiClientError } from '../api/client.js';
import { formatDayLabel } from '../query/dayMatching.js';
import { displayTitle } from '../query/searchIndex.js';
import { seatDisplay } from './seat.js';

export interface DetailDialogProps {
  session: Session;
  eventId: string;
  locale: string;
  /** True when the attendee holds this session (shows "reserved" in green). */
  reserved: boolean;
  onClose: () => void;
}

type AbstractState =
  | { status: 'present'; text: string }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'absent' };

export function DetailDialog(props: DetailDialogProps): JSX.Element {
  const { session, eventId, locale, reserved, onClose } = props;
  const st = session.sessionTime;

  const [fetched, setFetched] = useState<Session | null>(null);
  const [abstractState, setAbstractState] = useState<AbstractState>(
    session.abstract ? { status: 'present', text: session.abstract } : { status: 'loading' },
  );

  useEffect(() => {
    // The session already carries an abstract: nothing to fetch.
    if (session.abstract) {
      setAbstractState({ status: 'present', text: session.abstract });
      return;
    }

    let cancelled = false;
    setAbstractState({ status: 'loading' });
    getSession(eventId, session.sessionId, { locale })
      .then((full) => {
        if (cancelled) return;
        setFetched(full);
        setAbstractState(
          full.abstract
            ? { status: 'present', text: full.abstract }
            : { status: 'absent' },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError
            ? err.apiError.message
            : 'Could not load the session abstract.';
        setAbstractState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, locale, session.sessionId, session.abstract]);

  // Prefer any fuller record returned by GetSession for display fields.
  const s = fetched ?? session;
  const title = displayTitle(s);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">
          {s.abbreviation ? `${s.abbreviation} — ` : ''}Session Detail
        </div>
        <div className="dialog-body">
          <div className="field">
            <span className="k">Title</span>
            {title}
          </div>
          {s.abbreviation && (
            <div className="field">
              <span className="k">Code</span>
              {s.abbreviation}
            </div>
          )}
          <div className="field">
            <span className="k">Type / Level</span>
            {[s.type, s.level].filter(Boolean).join(' · ') || '—'}
          </div>
          <div className="field">
            <span className="k">When</span>
            {st
              ? `${formatDayLabel(st.date)} ${st.time} (${st.length} min)${
                  st.timezone ? ` ${st.timezone}` : ''
                }`
              : '—'}
          </div>
          <div className="field">
            <span className="k">Where</span>
            {[s.venue, s.room].filter(Boolean).join(' — ') || '—'}
          </div>
          <div className="field">
            <span className="k">Speakers</span>
            {(s.speakers ?? []).map((sp) => sp.name).join(', ') || '—'}
          </div>
          {s.tracks && s.tracks.length > 0 && (
            <div className="field">
              <span className="k">Tracks</span>
              {s.tracks.join(', ')}
            </div>
          )}

          {(() => {
            // The seat band follows the shared precedence: "reserved" (green)
            // overrides the catalog band, "walk-up" for walkUp sessions, else
            // the reservable band. A non-reservable session with no band (the
            // bare "--") shows no seat band at all.
            const seat = seatDisplay(s, reserved);
            if (seat.text === '--') return null;
            return <div className={`seat-band ${seat.className}`}>Seats: {seat.text}</div>;
          })()}

          <div className="abstract">
            {abstractState.status === 'present' && abstractState.text}
            {abstractState.status === 'loading' && (
              <span className="loading">Loading abstract…</span>
            )}
            {abstractState.status === 'error' && (
              <span className="error">{abstractState.message}</span>
            )}
            {abstractState.status === 'absent' && (
              <span className="loading">No abstract available for this session.</span>
            )}
          </div>
        </div>
        <div className="dialog-footer">Press Enter or Esc to close</div>
      </div>
    </div>
  );
}
