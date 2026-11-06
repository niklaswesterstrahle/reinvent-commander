// Shared fast-check arbitraries for Query_Engine property tests.
//
// Produces small catalogs of Session records with the fields the search index,
// filters, and sort read. Values are drawn from tight pools so collisions are
// frequent enough to exercise OR-within / AND-across filtering, tie-breaks, and
// day matching. Not production code — imported only by the *.test.ts files.

import type { Session } from '@reinvent-commander/shared';
import * as fc from 'fast-check';

/** Verified re:Invent 2026 dates — TEST FIXTURES ONLY, never production constants. */
export const FIXTURE_DATES = [
  '2026-11-29',
  '2026-11-30',
  '2026-12-01',
  '2026-12-02',
  '2026-12-03',
  '2026-12-04',
] as const;

const TITLE_WORDS = ['keynote', 'serverless', 'data', 'ml', 'security', 'builder', 'deep', 'dive'];
const ABBREVS = ['AIM200', 'SVS301', 'DAT401', 'SEC205', 'BLD101'];
const TRACKS = ['AI/ML', 'Compute', 'Databases', 'Security'];
const TYPES = ['Breakout', 'Workshop', 'Chalk Talk'];
const LEVELS = ['100', '200', '300', '400'];
const VENUES = ['Venetian', 'Wynn', 'MGM'];
const SPEAKERS = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper'];
const TIMES = ['09:00', '10:30', '13:00', '15:45'];

/** A single arbitrary session with the fields the Query_Engine reads. */
export const sessionArb: fc.Arbitrary<Session> = fc
  .record({
    id: fc.integer({ min: 0, max: 1_000_000 }),
    titleWords: fc.array(fc.constantFrom(...TITLE_WORDS), { minLength: 1, maxLength: 4 }),
    prefixCode: fc.boolean(),
    abbreviation: fc.constantFrom(...ABBREVS),
    hasAbstract: fc.boolean(),
    tracks: fc.array(fc.constantFrom(...TRACKS), { minLength: 0, maxLength: 2 }),
    type: fc.option(fc.constantFrom(...TYPES), { nil: undefined }),
    level: fc.option(fc.constantFrom(...LEVELS), { nil: undefined }),
    venue: fc.option(fc.constantFrom(...VENUES), { nil: undefined }),
    date: fc.option(fc.constantFrom(...FIXTURE_DATES), { nil: undefined }),
    time: fc.constantFrom(...TIMES),
    length: fc.constantFrom('30', '60', '90'),
    speakers: fc.array(fc.constantFrom(...SPEAKERS), { minLength: 0, maxLength: 2 }),
    topics: fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: 0, maxLength: 2 }),
  })
  .map((r): Session => {
    const body = r.titleWords.join(' ');
    const title = r.prefixCode ? `${r.abbreviation}: ${body}` : body;
    const session: Session = {
      sessionId: `s-${r.id}`,
      title,
      abbreviation: r.abbreviation,
      tracks: r.tracks,
      topics: r.topics,
      speakers: r.speakers.map((name) => ({ name })),
    };
    if (r.hasAbstract) session.abstract = `About ${body} in depth`;
    if (r.type) session.type = r.type;
    if (r.level) session.level = r.level;
    if (r.venue) session.venue = r.venue;
    if (r.date) {
      session.sessionTime = { date: r.date, time: r.time, length: r.length };
    }
    return session;
  });

/**
 * A catalog of sessions with unique sessionIds (the Query_Engine assumes the
 * Catalog_Store deduped by sessionId).
 */
export const catalogArb = (minLength = 0, maxLength = 25): fc.Arbitrary<Session[]> =>
  fc.array(sessionArb, { minLength, maxLength }).map((sessions) =>
    sessions.map((s, i) => ({ ...s, sessionId: `s-${i}` })),
  );
