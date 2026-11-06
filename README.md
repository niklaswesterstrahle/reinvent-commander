# re:Invent Commander

re:Invent Commander is a retro Norton Commander-style, keyboard-first dual-pane browser for the AWS re:Invent 2026 session catalog. The left panel is the session catalog; the right panel is your personal schedule — favorites, seat reservations, and personal time. It runs locally in your browser, is driven entirely by function keys and arrows, and treats the catalog like a filesystem you can navigate and filter. About 2,468 sessions. Two panels. Zero nonsense.

> Built for the **AWS re:Invent 2026 Event Catalog API Hackathon**. It integrates with the official AWS Events REST API and is a functional MVP rather than a maintained product.

## Why it runs locally

AWS Builder ID sign-in uses OAuth 2.0 Authorization Code flow with PKCE against a loopback redirect URI. The `redirect_uri` must be an exact match of `http://localhost:<port>/callback` on a port in the range **8484–8489**, and there is no hosted redirect option. Because of that, the app runs on your own machine.

A lightweight Fastify backend is the local OAuth broker, token vault, and API proxy. It owns the whole token lifecycle: your access, ID, and refresh tokens live server-side and never reach the browser. The browser holds only an opaque `HttpOnly; SameSite=Strict` session cookie that the backend maps to the server-side token set. Catalog and schedule calls go through the backend, which attaches the Bearer token on the way out.

## Prerequisites

- **Node.js 20+** (the repo is developed and tested on modern Node; Node 22+ works) and **npm** (bundled with Node). The workspaces declare `@types/node` ^20.
- A desktop **web browser**.
- A free **AWS Builder ID** to sign in. The re:Invent 2026 catalog is registration-gated, so sessions load only after you sign in.

This is a keyboard-first desktop app. Mobile and touch are out of scope.

## Install

From the repo root:

```bash
npm install
```

This installs dependencies for all three npm workspaces (`packages/shared`, `packages/backend`, `packages/web`).

## Run

From the repo root:

```bash
npm run start
```

This builds every workspace (`tsc -b`), builds the web bundle with Vite, then starts the Fastify backend. The backend serves the built SPA, binds the first free port in **8484–8489** on host `localhost`, and prints:

```
re:Invent Commander ready at http://localhost:<port>/
```

**Open that exact URL in your browser** (for example `http://localhost:8484/`). Everything — the UI, the `/api/*` proxy, the `/auth/*` routes, and the OAuth `/callback` — lives on that single origin.

Do **not** use a separate Vite dev server on `:5173` to sign in. Sign-in only works single-origin: the OAuth loopback callback and the `HttpOnly; SameSite=Strict` session cookie both require that the browser, the API proxy, and the callback share one origin. The `:5173` dev server is a different origin, so the session cookie is not sent and the callback cannot complete there.

If all six ports in 8484–8489 are taken, the backend exits with an actionable message telling you to free one of those loopback ports and restart.

`npm run dev` is an alias for `npm run start`.

## Sign in and use it

1. Press **F2** to sign in with AWS Builder ID. A browser sign-in flow opens.
2. After sign-in, the catalog loads (the full ~2,468-session catalog is walked and cached) and your schedule populates in the right panel.
3. Press **F2** again to sign out.

Sessions and tokens are held in memory by the backend, so restarting the backend means you sign in again. Because the catalog is registration-gated, the catalog stays empty until you have signed in.

## Keyboard reference

| Key | Action |
| --- | --- |
| **F1** | Help overlay |
| **F2** | Login / Logout (global toggle; label reflects state) |
| **F3** | View session detail |
| **F4** | Favorite the selected session (catalog panel) |
| **F5** | Reserve a seat for the selected session |
| **F6** | Toggle the active panel between folder **Tree** and flat **List** |
| **F7** | New personal time (schedule panel) |
| **F8** | Remove favorite / cancel reservation / delete personal time (schedule panel) |
| **F9** | Cycle the sort: advances field and ascending/descending direction on each press |
| **F10** | Quit (with confirmation) |

Movement and navigation: **Up/Down** arrows move the selection, **Tab** switches the active panel, **PageUp/PageDown** scroll a page, **Enter** opens the selected session's detail, **Esc** closes the topmost overlay, and **Backspace** ascends one level in the folder tree.

### Folder-tree navigation

Press **F6** to view a panel as a Norton Commander-style directory tree. Folders sort above sessions at every level, and a `..` entry ascends. The folder dimensions are **derived from the catalog data**, not hard-coded — a dimension with no values is omitted. Dimensions include **Day**, **Track**, **Type + Level**, **Topic**, and **Services**. Navigating into a folder tightens the filter (the path is an accumulated AND of predicates), and a breadcrumb shows where you are.

Drilling into **Day → a specific day** reveals morning / midday / afternoon / evening time buckets, with an Unscheduled bucket for sessions that have no resolvable time. The weekday for each session is computed from its date, so it is correct for any event year — no built-in calendar.

The schedule panel has its own day-folder tree view (keyed on Day only) over your reserved, favorited, and personal-time items.

### Search

A single search box filters the catalog. It matches session **title, code (abbreviation), abstract, and speaker names** as a substring, and also matches **day terms** like `monday`, `tue`, `dec 1`, or an ISO date. While a search term is active the catalog tree collapses to a flat result list spanning all folders; clearing the search returns you to the folder level you were at.

## Build, test, and lint

From the repo root:

```bash
npm run build   # tsc -b across all workspaces
npm run test    # vitest run (single run, ~197 tests)
npm run lint    # eslint
```

The test suite is around 197 tests, including fast-check property-based tests over the search/sort/filter engine, the folder tree, the PKCE and token handling, and the bulk-result handling. Playwright is configured for end-to-end tests (`npm run e2e`).

## How it uses the API

re:Invent Commander builds against the **AWS Events REST API** (OpenAPI 3.1 at `https://api.awsevents.com/v1/openapi.json`). The same data is also offered as an MCP server, but this project chose REST because the MCP server requires sign-in for every call, including catalog reads, whereas REST allows anonymous reads of public, non-gated events.

Operations exercised through the backend proxy:

- `ListEvents`, `GetEvent` — event discovery.
- `ListSessions` — the paginated catalog walk (follow `nextToken` until exhausted), plus `GetSession` for a single session's detail/abstract.
- `GetSchedule` — the attendee's reserved, favorited, and personal-time items.
- `AssociateFavorites`, `DisassociateFavorite` — favorites.
- `ReserveSessions`, `CancelReservation` — seat reservations.
- `CreatePersonalTime`, `UpdatePersonalTime`, `DeletePersonalTime` — personal time blocks.

The backend batches bulk favorite and reservation calls into groups of **at most 10** and aggregates the `successful`/`failed` results across batches, so a partial failure in one batch does not lose the rest. It honors `Retry-After` on `429` responses with bounded retries, and performs a single `401` refresh-and-retry before prompting you to sign in again. Tokens never appear in responses or logs.

## Project structure

Three npm workspaces:

- **`packages/shared`** — TypeScript types shared by the backend and web app, mirroring the documented API schema (sessions, schedule, bulk results, the normalized error envelope).
- **`packages/backend`** — the Node + Fastify local service: static SPA host, OAuth PKCE broker and `/callback` listener, in-memory token vault + session store, and the authenticated API proxy with batching, retry, and error normalization.
- **`packages/web`** — the React + Vite SPA (TypeScript): the retro TUI renderer, the keyboard engine and context-aware keymap, the catalog cache, the client-side Query_Engine (search/filter/sort), and the folder-tree navigation.

## Testing

Tests run with **Vitest** (`npm run test`, single run). Correctness-critical logic — search, sort, filtering, the folder tree, PKCE, token redaction, and bulk-result handling — is covered by **fast-check** property-based tests alongside example-based tests. **Playwright** is configured for end-to-end coverage via `npm run e2e`.
