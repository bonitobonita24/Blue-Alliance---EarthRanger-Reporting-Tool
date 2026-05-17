# SPEC — Blue Alliance EarthRanger Reporting Tool

> **Spec-Driven Build Prompt.** This document is the single source of truth for rebuilding the application from scratch. It is written so that an AI coding agent (Claude) can implement every file, feature, rule, and behavior without any other input besides this spec and a working EarthRanger account.

---

## 0. Mission & Identity

**Product name:** EarthRanger Patrol Manager (internally "Blue Alliance — EarthRanger Reporting Tool")

**Sponsor / domain:** Blue Alliance marine and coastal protected-area monitoring across **Mindoro** and **Palawan**, Philippines. Operators track ranger patrols (foot + seaborne) inside EarthRanger and need a fast desktop dashboard plus printable reports.

**One-line purpose:** Mirror EarthRanger patrol records into a local cache, present them in a fast filterable table, and generate two kinds of printable reports (ad-hoc "Generate Report" and templated weekly/monthly/annual "Template Report") that include per-municipality coverage analytics computed from GPS tracks.

**Primary user:** A small ops team (≤10 people). Not a multi-tenant SaaS. No sign-in. Trusted internal network or VPN.

---

## 1. Build Constitution (Non-negotiable Rules)

These rules govern the whole codebase. Any contributor — human or AI — must obey them.

1. **No bundler, no framework.** The frontend is a **single static `public/index.html`** with inline `<style>` and `<script>`. The backend is **plain `node:http`**. No React/Vue/Next, no webpack/vite, no TypeScript compile step.
2. **ES Modules everywhere.** `package.json` has `"type": "module"`. Use `import` / `export`. No CommonJS.
3. **Node 22 (Bun-compatible) on the server, modern evergreen browser on the client.** Target `node >= 20`.
4. **Zero npm dependencies in `dependencies`.** The runtime uses only Node built-ins (`node:http`, `node:fs/promises`, `node:url`, `node:path`). The browser pulls **Leaflet 1.9.4** from the unpkg CDN — that is the only external runtime asset. Dev/test uses Node's built-in `node --test`.
5. **Filesystem is the database.** State lives in `data/` as JSON files written atomically (temp file + `rename`). Never use SQLite, Postgres, KV, or a cloud DB.
6. **Deployment target is Docker Compose.** Vercel/Edge runtimes are explicitly out of scope. The container exposes a single port and persists `./data` as a host volume.
7. **EarthRanger is the source of truth for patrols.** The local cache is read-through; it is repopulated by a background sync engine. It must survive container restarts.
8. **No auth in the app itself.** Auth is solely the bearer/basic credential to EarthRanger, supplied via env vars. The dashboard is reachable to anyone who can reach the port.
9. **All time math goes through `Date.parse` / ISO strings; track durations use `Math.abs(t1 - t0)`** because EarthRanger returns track points **newest-first** so adjacent time deltas can be negative.
10. **Atomic writes.** `data/patrol-cache.json` and every `data/patrol-tracks/<id>.json` is written via temp-file + `rename`. Concurrent writers are serialized through a single in-process promise chain.
11. **Backwards compatibility for cached files.** The cache normalizer must tolerate older shapes and never crash on a malformed/empty file — it returns an empty cache and overwrites.
12. **Test what hurts to break.** Provide `node --test` unit tests for: `haversineKm`, `nearestBoundary`, `extractCoordinatesWithTimes`, `aggregateAreaCovered`, `async-pool` concurrency cap, `patrol-cache` upsert. UI does not have automated tests; smoke-test manually via Playwright when needed.

---

## 2. High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Browser (single-page UI in public/index.html)                             │
│  - Vanilla JS, Leaflet 1.9.4                                               │
│  - localStorage: municipality DB + legacy custom boundaries                │
│  - Calls /api/* on same origin                                             │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │ same-origin HTTP
┌──────────────────────────────▼─────────────────────────────────────────────┐
│  Node.js HTTP server (server.js)                                           │
│  - node:http; static files from /public                                    │
│  - 9 API handlers in /api/*.js                                             │
│  - Imports & starts background sync (lib/patrol-sync.js)                   │
└─────┬───────────────────────────────────────────────────────────────────┬──┘
      │                                                                   │
      │ EarthRanger /api/v1.0/*                                Filesystem │
      ▼                                                                   ▼
┌──────────────────────┐                              ┌──────────────────────────┐
│ EarthRanger server   │                              │ data/                    │
│ (HTTPS, Bearer/Basic)│                              │   patrol-cache.json      │
│ /activity/patrols/   │                              │   patrol-tracks/<id>.json│
│ /activity/events/    │                              │   patrol-tracks-index.json│
│ /subject/<id>/tracks/│                              └──────────────────────────┘
└──────────────────────┘
```

**Two background loops** run inside the same Node process:
- **Active check** every 120s — pulls newest 5 pages × 100 patrols and refreshes a small bounded set of sync candidates.
- **Deep sync** every 600s — paginates the entire patrol history (up to 100 pages × 200), refreshing the cache. Also runs once on startup.

Both call `syncTracksForPatrols(patrols)` after upserts so GPS tracks are persisted per patrol.

---

## 3. Repository Layout

```
.
├── server.js                       # Entry: HTTP server + static + route table
├── package.json                    # type: module, scripts (dev/start/test/cache:backfill)
├── Dockerfile                      # node:22-slim, copy api/lib/public/scripts
├── docker-compose.yml              # service "earthranger-reporting-tool", port 41739, ./data volume
├── .env.example                    # ER_BASE_URL, ER_TOKEN, ER_USERNAME/PASSWORD, etc.
├── api/                            # One file per route, default-export handler(req,res)
│   ├── health.js
│   ├── events.js
│   ├── cache-refresh.js
│   ├── area-covered.js
│   ├── patrol-kilometers.js
│   ├── patrol-tracks.js
│   ├── patrols.js
│   ├── patrols-update.js
│   └── sync-status.js
├── lib/                            # Pure Node modules (no req/res)
│   ├── earthranger.js              # HTTP client + typed helpers
│   ├── patrol-cache.js             # Read-through patrol cache
│   ├── patrol-sync.js              # Active-check + deep-sync timers
│   ├── track-store.js              # data/patrol-tracks/* atomic IO
│   ├── track-utils.js              # extractCoordinates, haversineKm, nearestBoundary
│   ├── area-covered.js             # aggregateAreaCovered() — pure
│   └── async-pool.js               # Bounded concurrency helper
├── scripts/
│   └── backfill-patrol-cache.js    # One-shot historic harvest (npm run cache:backfill)
├── public/
│   └── index.html                  # Monolithic SPA (~5500 lines)
├── test/                           # node:test files
│   ├── area-covered.test.js
│   ├── async-pool.test.js
│   ├── earthranger.test.js
│   ├── patrol-cache.test.js
│   ├── patrol-sync.test.js
│   ├── track-store.test.js
│   └── track-utils.test.js
└── data/                           # Created at runtime; gitignored
    ├── patrol-cache.json
    ├── patrol-tracks-index.json
    └── patrol-tracks/
        └── <patrol-id>.json
```

---

## 4. Environment Contract

`.env.example` (copy to `.env.local`):

```
ER_BASE_URL=https://your-earthranger-server.example
ER_USERNAME=
ER_PASSWORD=
ER_TOKEN=
ER_TRACK_TOKEN=
DAS_WEB_TOKEN=
ER_TIMEOUT_MS=30000
PATROL_CACHE_PATH=/app/data/patrol-cache.json
PATROL_SYNC_INTERVAL_MS=60000
PATROL_SYNC_LATEST_PAGE_SIZE=100
PATROL_SYNC_LATEST_PAGES=5
```

Resolution rules in `lib/earthranger.js`:

- `ER_BASE_URL` is required. If it doesn't already end in `/api/v1.0`, the lib appends it. A trailing slash is stripped.
- Auth header preference order:
  1. `ER_TOKEN` → `Bearer …`
  2. else `ER_TRACK_TOKEN` → `Bearer …`
  3. else `DAS_WEB_TOKEN` → `Bearer …`
  4. else `ER_USERNAME` + `ER_PASSWORD` → `Basic base64(user:pass)`
- If none present, throw `"Missing auth. Set ER_TOKEN (or ER_TRACK_TOKEN / DAS_WEB_TOKEN), or ER_USERNAME + ER_PASSWORD."`
- All requests use an `AbortController` with `ER_TIMEOUT_MS` (default 30000).
- Response: `JSON.parse` body; on non-OK throw `EarthRanger request failed (<status>): <payload.detail or JSON>`.

Server-side env consumed elsewhere:

- `PORT` (default `3000` in code, but **set to 41739** in compose).
- `PATROL_CACHE_PATH` (default `/app/data/patrol-cache.json`).
- `ACTIVE_CHECK_INTERVAL_MS` (default 120000).
- `DEEP_SYNC_INTERVAL_MS` (default 600000).
- `PATROL_SYNC_LATEST_PAGE_SIZE` (default 100), `PATROL_SYNC_LATEST_PAGES` (default 5).

Tracks-store path is hard-coded relative to `process.cwd()` → `data/patrol-tracks/` and `data/patrol-tracks-index.json`. (Configurable via `configureTrackStore({ rootDir })` for tests.)

---

## 5. Server Contract (`server.js`)

- Reads `process.env.PORT` (default 3000).
- Builds a route table mapping regex → handler:
  ```js
  /^\/api\/cache-refresh\/?$/    → cacheRefreshHandler
  /^\/api\/health\/?$/           → healthHandler
  /^\/api\/events\/?$/           → eventsHandler
  /^\/api\/area-covered\/?$/     → areaCoveredHandler
  /^\/api\/patrol-kilometers\/?$/→ patrolKilometersHandler
  /^\/api\/patrol-tracks\/?$/    → patrolTracksHandler
  /^\/api\/patrols\/?$/          → patrolsHandler
  /^\/api\/patrols-update\/?$/   → patrolsUpdateHandler
  /^\/api\/sync-status\/?$/      → syncStatusHandler
  ```
- For each request: parse URL, find matching route; if found, read JSON body, dispatch handler. Otherwise fall through to static-file serving from `/public`, with `index.html` as the fallback for any non-matching path (SPA-style).
- `readJsonBody(req)` buffers until `end`, then `JSON.parse` if `content-type: application/json`, else returns `{}`.
- `createApiResponse(res)` exposes an Express-like `.status(n).json(obj)` shim so handlers can be written as `res.status(200).json(payload)`.
- Static MIME map: `.html` text/html, `.css` text/css, `.js` text/javascript, `.json` application/json, `.svg` image/svg+xml, `.txt` text/plain — all UTF-8.
- Path traversal guard: resolved file must `startsWith(PUBLIC_DIR)`, else fall back to `index.html`.
- On startup: `server.listen(PORT)`, then `startPatrolSync()`.

---

## 6. API Reference

All handlers default-export `async function handler(req, res)` and use the shim. Method mismatches return `405 { error: 'Method not allowed' }`. Internal errors return `500 { error: <message> }`.

### 6.1 `GET /api/health`
Returns `{ ok: true, earthranger: 'ok' | 'unreachable', detail?: string, time }`. Internally calls `testConnection()` which fetches `/subjects/?page_size=1`. **Never** throws — on EarthRanger failure, sets `earthranger: 'unreachable'` with `detail`.

### 6.2 `GET /api/events?page_size=&updated_since=&sort_by=`
Thin pass-through to EarthRanger `/activity/events/`. Default `page_size=25`, `sort_by=-updated_at`.

### 6.3 `POST /api/cache-refresh`
Force-runs `runDeepSync()` and returns the sync status. UI's "Refresh Cache" button.

### 6.4 `GET /api/sync-status` · `POST /api/sync-status`
- GET → `getPatrolSyncStatus()` → `{ running, activeCheckIntervalMs, deepSyncIntervalMs, lastActiveCheck, lastDeepSync, lastError, cache: { path, totalCached, syncNeeded, updatedAt } }`.
- POST → triggers `runDeepSync()` then returns the same status.

### 6.5 `GET /api/patrols`
Query params: `page=1`, `page_size=25`, `since`, `until`, `patrol_type`, `status`, `sort_by=-serial_number`, `source`.

Two modes:
- **`source=cache`** → serve from local cache. Build a paginated response `{ data: { count, next, previous, results }, status, cache: { source: true } }`. Sort by `comparePatrols` which honors `sort_by` (`serial_number`, `-serial_number`, `start_time`, `-start_time`).
- **Default** → call EarthRanger `getPatrols`, then **upsert results into the local cache with source='api'**, then return EarthRanger payload with an added `cache` stats key.
- On EarthRanger error during GET, **fall back** to the cache (`fallback: true` flag) instead of returning 500.

### 6.6 `POST /api/patrols`
Creates a patrol on EarthRanger (`createPatrol(req.body)`). Returns `201` with the EarthRanger response.

### 6.7 `PATCH /api/patrols-update?patrol_id=<id>`
Updates a patrol via EarthRanger `PATCH /activity/patrols/<id>/`. Returns the updated patrol JSON. `400` if `patrol_id` missing.

### 6.8 `GET /api/patrol-tracks?id=<patrol-id>`
Returns `{ patrol_id, subject_id, subject_name, since, until, tracks, source? }`.

Resolution order:
1. In-memory TTL cache (`10 min`) keyed by `String(patrolId)`. Hit → return cached.
2. Locate the patrol in the local cache by `id` or `serial_number`. If missing → `404 { error: 'Patrol not found in cache' }`.
3. Read `segments[0].leader.id` (the GPS-tracked subject). If missing → `404 { error: 'Patrol has no GPS-tracked subject' }`.
4. `since = segments[0].time_range.start_time`; `until = end_time || new Date().toISOString()`. If `since` missing → `400 { error: 'Patrol has no start time' }`.
5. Try reading disk track from `track-store.readTrack(id)`. Found → return with `source: 'cache'`.
6. Else call EarthRanger `getSubjectTracks(subjectId, since, until)`, take `response.data || response`, return (and cache in memory).

### 6.9 `POST /api/patrol-kilometers`
Body: `{ patrol_ids: string[] }`. Returns `{ results: { [patrolId]: km | null } }`. For each id:
- Hit the per-process Map cache.
- Look up patrol in cache → segment leader id + start/end.
- Fetch tracks → extract coordinates → sum haversine distance → round to 2 decimals.
- Wrap each fetch with a `.catch(null)` and run in parallel via `Promise.all`.

### 6.10 `POST /api/area-covered`
**This is the headline analytical endpoint.** Body:
```json
{
  "from": "2026-05-04T00:00:00Z",
  "to":   "2026-05-10T23:59:59Z",
  "patrolIds": ["..."],     // optional; derived from cache + date range if omitted
  "boundaries": [           // required, ≥1
    {
      "id": "default-apo-reef-park",
      "name": "Apo Reef Park",
      "geometry": { "type": "LineString", "coordinates": [[lon,lat], ...] },
      "geometryType": "LineString"
    }
  ]
}
```
Also accepts **GeoJSON `Feature` shape** where `id` and `name` live under `properties.id` / `properties.name`. Handler must read both shapes (helpers `boundaryId(b) = b?.id ?? b?.properties?.id`, `boundaryName(b) = b?.name ?? b?.properties?.name`).

Response:
```json
{
  "aggregates": {
    "<boundary_id>": {
      "boundary_name": "Apo Reef Park",
      "coverage_patrols": 9,
      "coverage_km": 142.3,
      "coverage_hrs": 27.8,
      "hrs_estimated_count": 3,
      "hrs_actual_count": 6
    }
  },
  "missing_tracks": ["patrol_id_1", "patrol_id_2"],
  "generated_at": "2026-05-15T06:30:00Z"
}
```
Algorithm — see §10.

### 6.11 Error envelope
Every handler that fails returns `{ "error": "<message>" }` with appropriate HTTP code. Never leak stack traces.

---

## 7. EarthRanger Client (`lib/earthranger.js`)

Public functions (all `async` returning the parsed JSON payload):

| Function | Endpoint | Notes |
|---|---|---|
| `testConnection()` | `GET /subjects/?page_size=1` | Used by `/api/health`. |
| `getPatrols(params)` | `GET /activity/patrols/` | Forwards `page`, `page_size`, `since`, `until`, `patrol_type`, `status`, `sort_by`. Empty values are skipped. |
| `getPatrol(id)` | `GET /activity/patrols/<id>/` | Single-patrol refresh. |
| `createPatrol(payload)` | `POST /activity/patrols/` | |
| `updatePatrol(id, payload)` | `PATCH /activity/patrols/<id>/` | |
| `getEvents(params)` | `GET /activity/events/` | |
| `getSubjectTracks(subjectId, since, until)` | `GET /subject/<subjectId>/tracks/?since=&until=` | Returns GeoJSON `FeatureCollection` (or `Feature`). **Track coordinates come back newest-first.** |

Internal:
- `getBaseUrl()` — trims trailing slash, appends `/api/v1.0` if missing.
- `getAuthHeader()` — bearer / basic precedence as in §4.
- `erFetch(path, { method, query, body })` — applies URLSearchParams, Authorization, JSON content type, AbortController timeout, JSON-parses response, throws on `!response.ok`.

---

## 7.1 EarthRanger Connection: Establishing & Verifying

This is the bootstrap procedure an operator (or an AI rebuilding from scratch) must follow before the dashboard is usable. The app cannot synthesize an EarthRanger; it must point at a real instance and authenticate.

**Step 1 — Obtain credentials from the EarthRanger administrator.** Exactly ONE of:

- A long-lived **API token** (preferred) → `ER_TOKEN`. Issued via the ER admin UI under *User → Personal API Tokens* (or by an instance admin).
- A legacy **tracks token** → `ER_TRACK_TOKEN`. Used by older PAMDAS deployments.
- A legacy **DAS web token** → `DAS_WEB_TOKEN`.
- A service-account **username + password** → `ER_USERNAME` + `ER_PASSWORD`. The client Base64-encodes these into a `Basic` header. Acceptable but discouraged because it implies session/cookie auth on some instances.

The token's role/permissions must allow:

| Endpoint | Used by |
|---|---|
| `GET /subjects/?page_size=1` | `/api/health` connectivity probe |
| `GET /activity/patrols/` | List sync, dashboard live mode |
| `GET /activity/patrols/<id>/` | Sync-candidate refresh |
| `GET /activity/events/` | `/api/events` pass-through |
| `GET /subject/<id>/tracks/?since=&until=` | Track persistence + map modal |
| `POST /activity/patrols/` | UI patrol create (optional) |
| `PATCH /activity/patrols/<id>/` | UI patrol edit (optional) |

If the token lacks any **read** scope, the corresponding feature degrades silently — the dashboard renders, but tracks or events will be empty. If it lacks **write** scope, the affected button surfaces the ER 403 verbatim.

**Step 2 — Set `ER_BASE_URL`.** Use the **host root only** without `/api/v1.0`:

- `https://my-org.pamdas.org` ✓
- `https://earthranger.example.com/api/v1.0` ✓ (also accepted; client detects and keeps it)
- `https://earthranger.example.com/` ✓ (trailing slash trimmed)
- `my-org.pamdas.org` ✗ (missing scheme → `fetch` throws)

The client normalizes this once at module load via `getBaseUrl()`.

**Step 3 — Smoke-test from the host, OUTSIDE the container.** This isolates network/auth issues from app issues:

```bash
# With bearer
curl -sS -H "Authorization: Bearer $ER_TOKEN" \
  "$ER_BASE_URL/api/v1.0/subjects/?page_size=1" | head -c 400

# With basic
curl -sS -u "$ER_USERNAME:$ER_PASSWORD" \
  "$ER_BASE_URL/api/v1.0/subjects/?page_size=1" | head -c 400
```

Expected: `200 OK` with `{ "data": { "results": [ ... ] } }`. Any other outcome (HTTP 401/403/404, DNS failure, TLS error, timeout) must be resolved here. Booting the dashboard against a broken connection just produces a sync engine that fails every 2/10 minutes and stamps `lastError` repeatedly.

**Step 4 — Write `.env.local`** (do NOT commit). Minimum viable file:

```dotenv
ER_BASE_URL=https://my-org.pamdas.org
ER_TOKEN=eyJhbGc...
ER_TIMEOUT_MS=30000
```

`.env.example` is the shipped template; `.env.local` is the gitignored real one consumed by `docker-compose.yml` via `env_file`.

**Step 5 — Start the app and verify the in-app health endpoint:**

```bash
docker compose up -d --build
curl localhost:41739/api/health
# → { "ok": true, "earthranger": "ok", "time": "2026-..." }
```

If `earthranger: "unreachable"`, inspect `detail` — it is the verbatim error from `testConnection()` (no stack, just the ER payload or HTTP message).

**Step 6 — Confirm the first deep-sync has fired:**

```bash
curl -s localhost:41739/api/sync-status | jq
# → look for lastDeepSync (ISO timestamp) and cache.totalCached > 0
```

`lastDeepSync` is stamped at the end of every successful deep-sync. If after ~10 minutes it is still `null` and `lastError` is non-null, the sync engine cannot reach ER even though the health probe passed — usually a permissions or `/activity/patrols/` scope issue.

**Step 7 — Optional fast-prime the cache.** With an empty `data/patrol-cache.json`, the deep-sync alone could take hours to walk historic patrols. For instant fill:

```bash
docker compose exec earthranger-reporting-tool npm run cache:backfill
```

The script paginates `/activity/patrols/?page_size=200` until `next === null` or the dup-plateau hits, writing each batch with `source: 'backfill'`. It is idempotent and safe to re-run.

**Step 8 — Production hardening.** Once the cache is primed and `/api/health` is green, gate the port:

- Put the container behind a reverse proxy (Caddy, nginx, Traefik) or VPN — the app has no auth (§22.2).
- Set `restart: unless-stopped` in compose (already specified).
- Schedule `tar czf backup-$(date +%F).tgz data/` nightly on the host (§22.4).

---

## 7.2 EarthRanger API Limits & Resilience

EarthRanger does **not** publish formal rate limits. The deployed PAMDAS / partner instances we target generally do not enforce server-side throttling. The client therefore takes a **conservative, self-throttling** posture — it never bursts. The table below is the contract; deviations from these defaults must be justified.

### 7.2.1 Implemented throttles (client-side)

| Concern | Default | Configurable via | Notes |
|---|---|---|---|
| Per-request timeout | 30 000 ms | `ER_TIMEOUT_MS` | `AbortController`; throws `AbortError` on expiry. |
| Track-fetch concurrency | 4 in-flight | `TRACK_FETCH_CONCURRENCY` (const) | Enforced by `asyncPool`. Errors swallowed per-item. |
| Active-check page size | 100 | `PATROL_SYNC_LATEST_PAGE_SIZE` | Patrol list pagination. |
| Active-check max pages | 5 | `PATROL_SYNC_LATEST_PAGES` | Hard cap: 500 patrols per active tick. |
| Active-check interval | 120 000 ms | `ACTIVE_CHECK_INTERVAL_MS` | `setInterval` is `unref()`-ed. |
| Active-check candidate refresh | 50 patrols | const | Serial single-patrol GETs after pagination. |
| Deep-sync page size | 200 | const `DEEP_SYNC_PAGE_SIZE` | If ER caps lower, deep-sync silently truncates. |
| Deep-sync max pages | 100 | const `DEEP_SYNC_MAX_PAGES` | Hard ceiling: 20 000 patrols per deep-sync. |
| Deep-sync interval | 600 000 ms | `DEEP_SYNC_INTERVAL_MS` | Also fires once on startup. |
| Track window | `[segment.start_time, end_time ?? now]` | n/a | Not sliced; one fetch per patrol. |
| Overlap protection | Mutex flag | n/a | Concurrent `runDeepSync` calls return existing status. |

Sustained worst-case outbound load on EarthRanger:

- **List requests:** `5 + 100 = 105` per 10-minute cycle ≈ 1 request every 5–6 s peak.
- **Per-patrol GETs:** ≤50 per active check + per-patrol refreshes during deep sync, serialized.
- **Track GETs:** capped at 4 in-flight, processed in `asyncPool` batches; one GET per new/active patrol per cycle.

### 7.2.2 Gaps to verify against YOUR EarthRanger instance

Before going to production, the operator (or AI) MUST verify:

1. **Maximum `page_size` actually honored** by `/activity/patrols/`. PAMDAS commonly caps at 200; some instances cap lower. If yours caps at 100, change `DEEP_SYNC_PAGE_SIZE` to 100 — otherwise deep-sync paginates against a server that's silently returning short pages, and history beyond `100 × DEEP_SYNC_MAX_PAGES = 10 000` is invisible.
2. **Track-window upper bound.** Does `/subject/<id>/tracks/?since=&until=` truncate beyond N days? Long-running patrols (>30 days) would need slicing.
3. **Concurrent connection cap per token.** If your instance is shared with other tools, lower `TRACK_FETCH_CONCURRENCY` to 2.
4. **Rate-limit headers.** Inspect a real response for `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`. If present, see §7.2.3.
5. **Auth lifetime.** Some ER instances rotate tokens automatically; others use 1-year statics. If yours rotates, document the rotation cadence and add a calendar reminder.

A simple verification one-liner (run from the host):

```bash
curl -sS -D- -H "Authorization: Bearer $ER_TOKEN" \
  "$ER_BASE_URL/api/v1.0/activity/patrols/?page_size=500" \
  | sed -n '1,20p'
```

Look at the response headers and the actual `results.length`. If `results.length < 500`, the server is enforcing a smaller cap.

### 7.2.3 Resilience features NOT YET implemented (planned)

The current implementation has **no retries, no backoff, and no rate-limit handling**. Every error fails the current cycle; the next tick fires on its normal schedule. This is acceptable for the trusted-network ops model we target but is the first thing to harden if EarthRanger becomes shared, public, or rate-limited.

Spec for the next iteration (do NOT silently add these — they are breaking changes to observability):

- **Retry with exponential backoff** on `5xx` and `fetch`-level network errors. 3 attempts, `500 ms / 2 s / 5 s`, ±20% jitter, capped at 2 retries per request, surfaced in `lastError` if the final attempt fails.
- **Respect `Retry-After`** on `429` and `503`. Pause the affected timer (active or deep) for the suggested duration; if header absent, default 60 s. Record `pausedUntil` in `/api/sync-status`.
- **Auth-failure circuit breaker.** Two consecutive `401`s suspend both timers and set `health.earthranger = "unauthorized"` until the next manual `/api/cache-refresh`. Prevents log spam on an expired token.
- **Per-cycle request budget.** Soft cap of `{list:50, patrol:200, track:100}` per deep-sync; cycle aborts cleanly when exceeded and continues next tick.
- **Health degradation tier.** `/api/health` returns `degraded` (not `ok`) when `lastError` is non-null and younger than `2 × DEEP_SYNC_INTERVAL_MS`.

### 7.2.4 What the client deliberately does NOT do

- **No request coalescing.** Two near-simultaneous `/api/patrol-tracks?id=X` calls produce one cache lookup; the second is a hit only if the first finished. There is no in-flight de-dup.
- **No client-side rate limiting of inbound HTTP.** A burst of dashboard users could each trigger their own track fetches against ER. Acceptable for ≤10 users.
- **No queueing.** If ER is slow, the active-check tick may overlap with the next deep-sync tick; the mutex resolves the collision by skipping, not queuing.

---

## 7.3 Failure Modes & Recovery

The system is designed to **fail open**: the cache and the UI remain usable when EarthRanger is unavailable. The dashboard's "Refresh Cache" button surfaces errors without throwing the UI.

| Failure | Symptom | Auto-Recovery | Manual Recovery |
|---|---|---|---|
| EarthRanger unreachable (DNS / network down) | `/api/health` → `unreachable`; `lastError` updates each tick | Next tick retries on schedule | Fix network; sync resumes silently |
| TLS handshake failure | `lastError` mentions `CERT_*` or `EPROTO` | None | Verify CA / cert pinning at proxy |
| `401 Unauthorized` (token expired / wrong) | `lastError` contains `401`; cache stale | None | Rotate token in `.env.local`; `docker compose restart` |
| `403 Forbidden` (token lacks scope) | Some endpoints work, others fail | None | Request elevated token from ER admin |
| `404 Not Found` on patrol GET | Single patrol fails refresh; cycle continues | Next cycle retries | None usually needed; investigate if persistent |
| `429 Too Many Requests` | Cycle fails; next tick retries — risk of thrash | None (currently) | Raise `ACTIVE_CHECK_INTERVAL_MS` and `DEEP_SYNC_INTERVAL_MS`; lower `TRACK_FETCH_CONCURRENCY` |
| `500/502/503/504` from ER | Cycle fails; logged to `lastError` | Next tick retries | Wait or escalate to ER ops |
| Request timeout (`AbortError`) | Cycle fails for affected request | Next tick retries | Raise `ER_TIMEOUT_MS` if persistent |
| Empty cache on first boot | Dashboard shows 0 patrols momentarily | Deep-sync runs on startup; full fill ≤ several hours | Run `npm run cache:backfill` for instant fill |
| Corrupt `patrol-cache.json` | `loadCache()` returns empty cache and overwrites | Self-healing per §1 rule 11 | Inspect `lastError`; usually no action |
| Disk full (`ENOSPC`) | All writes throw; every cycle fails | None — wedged until disk free | Free space on host volume; sync resumes |
| Partial track file (rare race) | `readTrack` JSON-parse fails | Treated as missing; refetched next cycle | None |
| Subject has no GPS data | `/api/patrol-tracks` returns empty `features` | n/a | UI shows "No GPS data" empty state |
| EarthRanger schema drift — new field added | Stored verbatim; cache normalizer ignores unknowns | Forward-compatible | None |
| EarthRanger schema break — field removed | Frontend renders blanks for that column | None | Patch the accessor with optional chaining |
| Container OOM / restart | In-memory caches (track TTL, km) lost | Auto-restart per compose; rehydrate on next request | None |

**Diagnostic command cheat sheet:**

```bash
# Health + ER reachability
curl localhost:41739/api/health

# Sync engine state (lastError is the key field)
curl localhost:41739/api/sync-status | jq '.lastError, .lastDeepSync, .cache'

# Container logs since last restart
docker compose logs --since 1h earthranger-reporting-tool

# Cache size on host
du -sh data/patrol-cache.json data/patrol-tracks/

# Force a deep-sync now
curl -X POST localhost:41739/api/cache-refresh | jq
```

---

## 8. Local Patrol Cache (`lib/patrol-cache.js`)

File: `${PATROL_CACHE_PATH}` (compose default `/app/data/patrol-cache.json`).

Schema:
```json
{
  "version": 1,
  "updatedAt": "ISO",
  "patrols": {
    "<patrol-id>": {
      "firstSeenAt": "ISO",
      "lastFetchedAt": "ISO",
      "lastSyncedAt": "ISO | null",
      "source": "api" | "sync" | "backfill",
      "syncNeeded": boolean,
      "patrol": { /* full EarthRanger patrol object */ }
    }
  }
}
```

Key rules:
- `getPatrolKey(p)` = `String(p.id || p.uuid || p.serial_number).trim()`. Must be non-empty.
- `shouldKeepSyncing(patrol)`:
  - `false` if patrol state ∈ `closed | done | completed | cancelled | canceled` (case-insensitive).
  - `true` if any segment has `start_time` but no `end_time` (i.e. still active).
- `loadCache()` — read file; if missing/malformed/empty, return `normalizeCache()` (an empty `{ version:1, updatedAt:null, patrols:{} }`). Retries up to `CACHE_RETRIES=3` if `JSON.parse` throws transient errors during concurrent writes.
- `saveCache(cache)` — serialized through a single `writePromise` chain. **Re-reads disk** and merges so concurrent partial updates don't overwrite each other. Writes to `${CACHE_PATH}.<pid>.<ts>.tmp` then `rename`.
- `upsertPatrols(patrols, source)` — for each patrol: preserve `firstSeenAt`, refresh `lastFetchedAt`, set `lastSyncedAt = now` only when `source === 'sync'`, recompute `syncNeeded`. Returns updated stats.
- `getCachedPatrols()` — flat array of `entry.patrol`.
- `getSyncCandidatePatrols(limit=100)` — entries with `syncNeeded` truthy, sorted by oldest `lastSyncedAt || lastFetchedAt || firstSeenAt`, sliced.
- `clearCache()` — overwrite file with empty.
- `getCacheStats()` — `{ path, totalCached, syncNeeded, updatedAt }`.

---

## 9. Sync Engine (`lib/patrol-sync.js`)

Two unref'd `setInterval` timers start on `startPatrolSync()`. The engine never throws to the event loop — every error is logged + stored in `lastError`.

- `ACTIVE_CHECK_INTERVAL_MS` (default 120000) — `runActiveCheck()`.
- `DEEP_SYNC_INTERVAL_MS` (default 600000) — `runDeepSync()`. Also fires once immediately on startup.
- Mutex: a module-level `running` flag prevents overlap. If `running`, the call returns the existing status.

`runActiveCheck()`:
1. Paginate `getPatrols({ page, page_size: LATEST_PAGE_SIZE, sort_by: '-serial_number' })` up to `LATEST_PAGES` pages.
2. After each page: `upsertPatrols(results, 'sync')` and `syncTracksForPatrols(results)`.
3. Then read 50 sync candidates from the cache, refresh each via `getPatrol(id)`, upsert + sync tracks.

`runDeepSync()`:
1. Paginate the entire patrol list with `page_size=DEEP_SYNC_PAGE_SIZE (200)` up to `DEEP_SYNC_MAX_PAGES (100)`.
2. Per page: upsert with source `sync`, then sync tracks.

`syncTracksForPatrols(patrols)`:
- For every patrol: needs `segment[0].leader.id` and `segment[0].time_range.start_time`. Skip if `hasTrack(id)` and `!needsRefetch(patrol)`.
- Concurrency capped at `TRACK_FETCH_CONCURRENCY=4` via `asyncPool`.
- On success: `writeTrack(id, track)` + `upsertIndexEntry(id, …)` recording `fetched_at`, `has_timestamps`, `point_count`, `last_track_time`, `patrol_ended`, `subject_id`, `since`, `until`.

---

## 10. Area Covered Algorithm (`lib/area-covered.js`)

```
aggregateAreaCovered({ patrolIds, boundaries, patrolHoursById })
  for each patrolId:
    track = readTrack(patrolId)
    if !track: missing_tracks.push(patrolId); continue
    accumulatePatrol({ track, boundaries, patrolTotalHrs, aggregates })
  return { aggregates, missing_tracks, generated_at }

accumulatePatrol(...)
  { coordinates, times, hasTimestamps } = extractCoordinatesWithTimes(track)
  if coordinates.length < 2: return
  perBoundaryKm = {}; perBoundaryHrs = {}; patrolTotalKm = 0

  for i in 1..N-1:
    a = coords[i-1]; b = coords[i]
    segKm = haversineKm(a, b)
    if segKm <= 0: continue
    patrolTotalKm += segKm

    hit = nearestBoundary(midpoint(a, b), boundaries)
    if !hit: continue
    bid = boundaryId(hit)
    perBoundaryKm[bid] += segKm

    if hasTimestamps:
      dtMs = Math.abs(times[i] - times[i-1])      # CRITICAL: order-independent
      perBoundaryHrs[bid] += dtMs / 3.6e6

  if !hasTimestamps and patrolTotalKm > 0:
    for (bid, km) in perBoundaryKm:
      perBoundaryHrs[bid] = patrolTotalHrs * km / patrolTotalKm   # pro-rate

  for each (bid, km) in perBoundaryKm:
    aggregates[bid] ??= { boundary_name, coverage_patrols:0, coverage_km:0,
                          coverage_hrs:0, hrs_estimated_count:0, hrs_actual_count:0 }
    aggregates[bid].coverage_patrols += 1
    aggregates[bid].coverage_km += km
    aggregates[bid].coverage_hrs += perBoundaryHrs[bid]
    if hasTimestamps: hrs_actual_count += 1
    else:             hrs_estimated_count += 1
```

Distance helpers in `lib/track-utils.js`:
- `haversineKm(a, b)` — earth radius `6371.0088`; expects `[lon, lat]` pairs; returns 0 on null.
- `midpoint(a, b)` — naive arithmetic; OK for small segments.
- `pointToLineDistanceKm(p, lineCoords)` — minimum perpendicular distance to a polyline.
- `segmentDistanceKm(p, a, b)` — uses an equirectangular projection centered on the segment's mean latitude (`scale = cos(latRef)`); clamps projection parameter `t ∈ [0,1]`.
- `nearestBoundary(point, boundaries)` — scans every boundary's lines and returns the boundary object whose nearest line wins. Lines extracted via `boundaryLines(b)` which understands `LineString`, `MultiLineString`, `Polygon` (returns rings), `MultiPolygon` (flattens), and raw `coordinates`.
- `extractCoordinatesWithTimes(track)` — walks `Feature` or `FeatureCollection`; pulls `feature.properties.coordinateProperties.times` per coordinate when lengths match. Sets `hasTimestamps=false` and zero-fills `times` when shapes diverge.

---

## 11. Track Store (`lib/track-store.js`)

- `rootDir = data/patrol-tracks`, `indexPath = data/patrol-tracks-index.json`. Overridable via `configureTrackStore({ rootDir })`.
- `writeTrack(id, track)` — atomic-write JSON to `<rootDir>/<id>.json` with trailing newline.
- `readTrack(id)` — returns parsed JSON or `null` on ENOENT.
- `hasTrack(id)` — fs.access check.
- `readIndex()` / `writeIndex(index)` — atomic JSON map.
- `upsertIndexEntry(id, entry)` — merges into the existing entry.
- `needsRefetch(patrol)` — `true` if no index entry, or patrol still active, or patrol just ended (`!entry.patrol_ended` && segment now has `end_time`).

---

## 12. Async Pool (`lib/async-pool.js`)

`asyncPool(concurrency, items, iterator, { swallowErrors=false })` — minimal bounded promise pool. Schedules up to `concurrency` in-flight promises at once. If `swallowErrors=true`, individual rejections are absorbed (used by track sync so one failing patrol does not break the batch).

---

## 13. Frontend — `public/index.html`

A single HTML document containing **three `<style>` blocks** (≈ 2000 lines combined) and **one `<script>` block** (≈ 4000 lines). The script holds ≈ 188 top-level functions. No build step, no module imports.

### 13.1 External assets
Exactly one script tag, after the closing inline `<style>`:
```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-…" crossorigin=""></script>
```
The matching Leaflet CSS is also pulled from unpkg. **Nothing else** is fetched from a CDN at runtime (ArcGIS calls are application data, not assets).

### 13.2 Top-level structural IDs
The page is a single non-tabbed dashboard. Notable IDs that must exist (the JS binds to them by id, no framework abstractions):

```
openMunicipalityManagerButton, activeFootCount, activeSeaborneCount,
activePatrolCount, activePatrolList, searchInput, trackedByChips,
trackedByInput, trackedBySuggestions, typeFilter, statusFilter, fromFilter,
toFilter, excludeTestFilter, ongoingFilter, timeWindowEnabled, timeWindowControls,
timeFromFilter, timeToFilter, timeFromOnlyField, timeFromOnlyFilter, timeWindowNote,
generateReportButton, clearFiltersButton, cacheRefreshButton,
templateRangeSelect, templateYearField, templateYearInput, templateMonthField,
templateMonthSelect, templateWeekField, templateWeekSelect, generateTemplateReportButton,
tableSummary, content, tableScrollProxy, tableScrollProxyInner, reportPanel,

# Boundary editor modal
boundary-modal, boundary-modal-title, closeBoundaryMenuButton,
boundary-editor-map, boundaryPointCount, undoBoundaryPointButton,
clearBoundaryDraftButton, saveBoundaryButton, closeBoundaryEditorButton,
cancelBoundaryEditorButton, newMunicipalityButton, deleteMunicipalityButton,
copyOfficialBoundaryButton, municipalityManagerList, municipalityNameInput,
municipalityAliasesInput, municipalityIslandInput, municipalityEnabledInput,

# GPS map modal (per-patrol track viewer)
map-modal, map-modal-title, map-modal-meta, map-modal-status, patrol-map,

# Generated report DOM (inside the new tab built by buildPrintReportHtml)
report-map, municipality-table-body, municipality-chart, municipality-status,
page-area-covered, area-covered-table, area-covered-chart,
area-covered-est-note, area-covered-missing-note,
variance-info-dialog, variance-info-title, paperLabel
```

### 13.3 Page Layout

1. **Header** — branding + two action buttons: "Manage Municipalities" (`openMunicipalityManagerButton`) and "Refresh Cache" (`cacheRefreshButton`).
2. **Active Patrols summary** — three counters (Foot, Seaborne, Total) and a list of currently-active patrols (`getActivePatrols()` filter: state in {open, active} AND segment exists AND segment has no `end_time`).
3. **Filters panel (left)**:
   - Search (text)
   - Tracked-by (multi-select chips with autocomplete fed by `getAllTrackerNames()`)
   - Patrol type (`typeFilter`, populated by `updateTypeOptions()` from cached data)
   - Status (`statusFilter`: open / scheduled / done / cancelled)
   - Date range (`fromFilter`, `toFilter`) — defaults to current week
   - Exclude test patrols checkbox
   - Show only ongoing checkbox
   - Advanced "start time window" (`timeWindowEnabled` reveals `timeFromFilter`/`timeToFilter`) — overnight-aware (10pm → 7am applies only within the selected day's evening portion; matches start times from `timeFrom` to `23:59` on each in-range day).
   - "Generate Report" (ad-hoc), "Clear Filters" buttons.
4. **Template Report panel** — `templateRangeSelect` ∈ {Annual, Monthly, Weekly}; year/month/week fields show/hide via `setTemplateFieldVisible`; "Generate Template Report" builds a templated period (`getWeeklyPeriod`, `getMonthlyPeriod`, `getAnnualPeriod`).
5. **Patrol Index Table** (`content`) — Excel-like, horizontally scrollable; a sticky scroll proxy at the bottom (`tableScrollProxy` + `tableScrollProxyInner`) mirrors the actual content width because the real table is inside an overflow container. JavaScript syncs scroll positions both ways.
6. **Modals**:
   - `boundary-modal` — municipality manager (boundary editor map + list + form).
   - `map-modal` — patrol-track viewer with a Leaflet map (`patrol-map`).
   - `variance-info-dialog` — inline explainer popped from Page 2 of the generated report.

### 13.4 Frontend state
- Top-level mutable state lives in `let` bindings inside the IIFE-style root: cached patrol list, current filters, selected municipality id, boundary editor draft points (`boundaryEditorPoints`), official preview features, etc.
- **`localStorage` keys (only two)**:
  - `MUNICIPALITY_DB_KEY = 'blueAlliance.municipalities.v1'` — normalized municipality records.
  - `CUSTOM_BOUNDARIES_KEY = 'blueAlliance.customBoundaries.v1'` — legacy migrated on first load by `mergeLegacyCustomBoundaries`.
- No cookies, no sessionStorage, no IndexedDB.

### 13.5 API endpoints consumed
Frontend touches **only** these endpoints (same-origin):

```
GET  /api/health
GET  /api/patrols?…             (live mode)
GET  /api/patrols?source=cache  (warm-load on first paint)
GET  /api/patrol-tracks?id=…    (map modal + report tracks)
POST /api/patrol-kilometers     (table KM column + report)
POST /api/cache-refresh         (cache button)
POST /api/area-covered          (template report page 3)
```

Auto-refresh: `setInterval(autoRefreshPatrols, 30_000)` — re-pulls page 1 if filters are non-restrictive.

### 13.6 Patrol Index columns
Default sort `-serial_number`. Columns (in order):
1. Serial number
2. Title
3. Type
4. Status (badge: open / scheduled / done / cancelled / draft)
5. Tracked by (subjects list)
6. Start location (icon + lat/lon)
7. End location
8. Start time (formatted local)
9. End time
10. Duration (hrs, formatted)
11. KMS (lazy-fetched per visible row via `/api/patrol-kilometers`; cached in-memory)
12. Objective (truncated)
13. Updated at
14. Actions: "View" (opens map modal), "Open in EarthRanger" (external link to `${ER_BASE_URL}/admin/activity/patrol/<id>/change/`).

Sort handler is `sortByColumn(column)` which toggles asc/desc per click.

### 13.7 Active Patrols rules
`isOngoingPatrol(p)`:
- State must be `open` or `active`.
- Segment must exist with `time_range.start_time` and no `time_range.end_time`.
- Cancelled patrols with missing end_time are **NOT** active.

`getActiveTypeCounts(activeList)` derives Foot vs Seaborne via patrol_type (`patrol_type_display` or `patrol_type` value containing "seaborne" → Seaborne else Foot).

### 13.8 Boundary editor modal
Opens via "Manage Municipalities" button.

UI:
- Left rail: municipality list rendered by `renderMunicipalityManagerList()`. Selecting a row triggers `selectMunicipality(id)`.
- Center: Leaflet map (`boundary-editor-map`) using CARTO Voyager tiles (`https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png`, subdomains `abcd`, max zoom 19, OSM attribution).
- Right: form with `municipalityNameInput`, `municipalityAliasesInput` (comma-separated), `municipalityIslandInput`, `municipalityEnabledInput` (checkbox), and action buttons.
- Click on the map → push `{lat, lng}` into `boundaryEditorPoints` and re-render the draft polyline/polygon (`drawBoundaryDraft`). `undoBoundaryPointButton` pops the last point. `clearBoundaryDraftButton` empties.
- `saveBoundaryButton` writes back to localStorage via `saveMunicipalities`.
- `copyOfficialBoundaryButton` copies the loaded official ArcGIS line into the editable draft so the user can tweak.

**Municipality record shape** (after `normalizeMunicipalityRecord`):
```js
{
  id: 'default-calapan' | 'custom-<timestamp36>',
  island: 'Mindoro' | 'Palawan' | 'Custom',
  name: 'Calapan',
  aliases: ['Calapan', 'calapan', ...],   // deduped, first entry is canonical
  source: 'official' | 'custom',
  enabled: true,
  overrideOfficial: false,                // becomes true if user saves ≥3 custom points
  geometryType: 'Polygon' | 'LineString',
  coordinates: [{ lat, lng }, ...]
}
```

**`DEFAULT_MUNICIPALITIES` (12 entries, must be embedded verbatim)**:
| Island | Name | Aliases |
|---|---|---|
| Mindoro | Calapan | calapan |
| Mindoro | Baco | baco |
| Mindoro | San Teodoro | san teodoro |
| Mindoro | Puerto Galera | puerto galera |
| Mindoro | Sablayan | sablayan |
| Mindoro | Apo Reef Park | apo reef, apo reef park, apo reef natural park |
| Palawan | Roxas | roxas |
| Palawan | Aracelli | aracelli, araceli |
| Palawan | El Nido | el nido |
| Palawan | Dumaran | dumaran |
| Palawan | Taytay | taytay |
| Palawan | Aborlan | aborlan |

All seeded as `source: 'official'`, `enabled: true`, `coordinates: []`. They acquire geometry at runtime by fetching the ArcGIS Municipal_Waters layer.

### 13.9 Official boundary preview (ArcGIS)
`loadOfficialBoundaryPreview(record)`:
1. Build `where` clause from `officialBoundaryWhereForRecord(record)` — uses `normalizeBoundaryName` (lowercase, alphanumeric-only) on `record.name` and every alias to construct OR'd `LOWER(municipali) LIKE '%<name>%'` filters.
2. Fetch:
   ```
   https://services1.arcgis.com/RTK5Unh1Z71JKIiR/arcgis/rest/services/Municipal_Waters/FeatureServer/0/query
     ?f=geojson&where=<…>&outFields=municipali,province
     &returnGeometry=true&outSR=4326&resultRecordCount=50
   ```
3. Filter features locally with `officialFeatureMatchesRecord` (defensive against ArcGIS LIKE quirks).
4. Render features as a **dashed cyan outline** (`color:#1fb6ff`, `dashArray:'6,4'`) on the boundary-editor map, in a separate layer `officialBoundaryEditorLayer`.
5. Update `boundaryPointCount` label with point count or "No official boundary line found".

`normalizeBoundaryName` is defined **at module top level** (≈ L1613 / L4053 — there are two for legacy reasons; both must exist or the report's call site breaks).

### 13.10 GPS map modal (per-patrol track viewer)
Bound to "View" action on each table row. Opens `map-modal`, sets title/meta, calls `/api/patrol-tracks?id=<id>`. Renders the track via `extractTrackCoordinates(payload.tracks)` onto a Leaflet map. Empty/loading states use the same Leaflet "map-empty" placeholder pattern as the report map.

### 13.11 Ad-hoc "Generate Report" (`buildPrintReportHtml`)
Opens a new tab containing a fully-styled self-contained HTML document (A4 landscape, `@page { size: A4 landscape; margin: 0; }`). Sections:

- **Header**: logo, report title, "PATROL INDEX REPORT", selected date range, generated timestamp.
- **Summary cards**: counts and KM totals by type.
- **Type subtotal table** (`renderTypeSubtotalTable`).
- **Patrol detail table** (`renderPatrolDetailTable`) — full row per patrol with locations, times, durations, KMS, objective.
- **Print controls** — paper size toggle (A4 / Letter / Legal) via `setPaperSize`, print button.

### 13.12 Template Report (`buildTemplateReportHtml`)
Three-page printable HTML opened in a new tab. Driven by the selected `templateRangeSelect` value and the resolved period:

- **Page 1 — Patrol Index** for the period: same layout as ad-hoc report but scoped to the period.
- **Page 2 — Municipality Summary** (`renderMunicipalitySummary`): table of every **enabled** municipality showing assigned patrols (by start-point nearest match `nearestStartMunicipality` plus name/alias match in `featureMatchesMunicipality`); a Leaflet map (`report-map`) overlays patrol tracks, custom boundaries (cyan filled polygons in `municipalWaterPane`), and ArcGIS official features (cyan outlines). Includes a chart (`buildMunicipalityChart`) and a variance dialog (`openVarianceInfo`) explaining estimation.
- **Page 3 — Area Covered** (`renderAreaCoveredPage`): table of only boundaries with `coverage_km > 0`, sorted by `coverage_km` DESC. Columns:
  - Boundary name
  - Coverage Patrols
  - Coverage KMS (`formatReportMetric`)
  - Coverage HRS — with an **"Est." badge** when `hrs_estimated_count > 0` for that boundary
  - Footer note explains "Est." rows; another footer line reports `missing_tracks.length` when > 0.
  - One bar chart (`area-covered-chart`) reusing Page 2's `buildMunicipalityChart` helper.
  - Empty state: a single row with "No coverage in monitored boundaries for this period."

The Page 2/3 boundaries set is the same: `getMunicipalityReportData()` returns `{ features }` where each feature is a GeoJSON `Feature` with `properties.id` and `properties.name`. The endpoint must read both shapes (see §6.10).

The template builder serializes the aggregates JSON into the generated tab via `escapeScriptJson` and embeds it as `const areaCovered = …;` (matching the existing `municipalityJson` pattern).

### 13.13 Print styling
- Two report variants share a font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.
- Body type 8pt, summary card label 8pt uppercase, value 14pt bold.
- Table `font-size: 8pt; page-break-inside: auto;`.
- Each `.report-page` is `page-break-after: always` except the last.
- Light grey `#f8fafc` summary cards with `#e2e8f0` border.

---

## 14. Filtering Behavior Spec

- Filters are applied **client-side** against `cachedPatrols`. Date filters do not refetch from EarthRanger.
- `patrolMatches(p, filters)` checks: text match (`searchInput` against title/serial/leaders/objective), tracked-by AND match across selected chips, type in selected list, status equal, date range start_time inside, `excludeTestFilter`, `ongoingFilter`, advanced start time window.
- `hasRestrictiveFilters(filters)` returns true if any field is non-default; used to suppress auto-refresh from clobbering the user's view.
- Date-range default = current week (Monday–Sunday) via `setDefaultDateRange`. Sunday is treated as the last day of the week (ISO).
- "Time window" semantics:
  - Same-day `08:00`–`18:00` matches `start_time` between those clock times on each selected date.
  - Overnight `22:00`–`07:00` matches start times from 22:00 through 23:59 on each in-range date (it does **not** spill into the next day for that date).
- `isTestPatrol(p)` recognizes test patrols via name/title regex (`/test|qa|demo/i`).

---

## 15. Reporting Period Resolution

`getSelectedTemplatePeriod()` returns `{ start: Date, end: Date, label, category }`:

- **Weekly** — `getWeeklyPeriod(year, month, weekIndex)` uses `getMonthWeekPeriods(year, month)` which splits the month into ISO weeks; `getLastCompletedWeek()` is the default. Label e.g. `Week 19 (May 4–10, 2026)`.
- **Monthly** — `getMonthlyPeriod(year, month)` → first→last day. Label `MAY 2026`.
- **Annual** — `getAnnualPeriod(year)` → Jan 1 → Dec 31. Label `2026 ANNUAL`.

`buildPeriod(start, end, label, category)` is the common factory.

`patrolStartsWithinPeriod(p, period)` — `start_time` ∈ `[period.start, period.end]`.

`getTemplatePatrolCategory(p)` classifies a patrol into Foot / Seaborne for summary cards.

---

## 16. Test Suite

All under `test/`, invoked by `npm test` → `node --test 'test/**/*.test.js'`. Must include:

| File | Asserts |
|---|---|
| `test/track-utils.test.js` | `haversineKm` numeric correctness; `extractCoordinatesWithTimes` handles `Feature` / `FeatureCollection` / missing times / mismatched lengths; `nearestBoundary` picks the closest boundary across `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`; **GeoJSON `Feature` shape** boundaries (with `properties.id`/`properties.name`) work. |
| `test/area-covered.test.js` | Pro-rates hours when `hasTimestamps=false`; uses real per-segment `Math.abs(dt)` when true; correctly increments `coverage_patrols`, `coverage_km`, `coverage_hrs`, `hrs_estimated_count`, `hrs_actual_count`; reports `missing_tracks`; **passes for both flat (`{id,name,geometry}`) and GeoJSON-Feature (`{properties:{id,name},geometry}`) boundary shapes**. |
| `test/async-pool.test.js` | Concurrency cap is honored; errors swallowed when `swallowErrors:true`; sequential ordering of `items`. |
| `test/patrol-cache.test.js` | Upsert preserves `firstSeenAt`; `lastSyncedAt` only set when `source==='sync'`; `shouldKeepSyncing` correctness across states; concurrent `saveCache` merges instead of clobbering. |
| `test/patrol-sync.test.js` | `runActiveCheck`/`runDeepSync` mutex; track-sync candidate selection skips closed patrols with existing tracks. |
| `test/track-store.test.js` | Atomic write/read round-trip; `readTrack` returns `null` on ENOENT; index merge semantics. |
| `test/earthranger.test.js` | Auth header precedence; `getBaseUrl` slash trimming + `/api/v1.0` suffixing; query-param dropping of empty values; error message format on non-OK. |

**Run command:** `npm test`. **Cache backfill:** `npm run cache:backfill`.

---

## 17. Build, Run, Deploy

### 17.1 Local dev
```bash
cp .env.example .env.local
# fill in ER_BASE_URL and one of ER_TOKEN / username+password
npm start          # node server.js
# open http://localhost:3000  (or whatever PORT)
```

### 17.2 Docker
```bash
npm run docker:up
# → http://localhost:41739
```

`Dockerfile`:
```dockerfile
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY api ./api
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
COPY server.js ./
EXPOSE 41739
CMD ["npm", "start"]
```

`docker-compose.yml`:
```yaml
name: blue-alliance-earthranger-reporting-tool

services:
  earthranger-reporting-tool:
    build: .
    container_name: blue-alliance-earthranger-reporting-tool-app
    env_file:
      - .env.local
    environment:
      PORT: 41739
      PATROL_CACHE_PATH: /app/data/patrol-cache.json
      PATROL_SYNC_INTERVAL_MS: 60000
      PATROL_SYNC_LATEST_PAGE_SIZE: 100
      PATROL_SYNC_LATEST_PAGES: 5
    ports:
      - "41739:41739"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

### 17.3 Backfill
`scripts/backfill-patrol-cache.js`: a one-shot Node script that walks every page of `/activity/patrols/?page_size=200` and writes them to the cache with source `backfill`. Stop conditions: API `next === null`, page count cap, or duplicate-key plateau. Run via `npm run cache:backfill`. Idempotent.

### 17.4 Verification (after rebuilding)
```bash
node --test 'test/**/*.test.js'   # all green
docker compose up --build         # boots on :41739
curl localhost:41739/api/health   # { ok:true, earthranger:'ok' }
curl localhost:41739/api/sync-status
```
Manually open the dashboard, generate a template report, and confirm Page 3 shows boundary rows with KMS/HRS.

---

## 18. Governance & Process Rules

1. **Memory before code.** Before changing a sensitive area (sync engine, cache shape, time math), search `MEMORY.md` for an existing entry. The current memory contains pointers to the GPS map feature, area-covered feature, track cache shape, track time order (newest-first), patrol cache file shape, and two recent bugfix notes — these are the load-bearing facts.
2. **One Docker target.** Do not introduce Vercel/Cloudflare/Edge. Do not add Next.js. Memory entry `project_deployment.md` is authoritative.
3. **No silent schema changes.** Cache JSON has `"version": 1`. If you ever change the shape, bump it and add a migrator in `loadCache()`.
4. **Atomic writes only.** All writes to `data/*` go through temp-file + `rename`. No partial writes.
5. **Newest-first track ordering.** EarthRanger returns track points newest-first. Always `Math.abs(times[i] - times[i-1])`. Comment this assumption in any new track math.
6. **Boundary shape duality.** Server-side helpers (`boundaryId`, `boundaryName`) and tests must handle both flat (`{id,name,geometry}`) and GeoJSON-Feature (`{properties:{id,name},geometry}`) boundary shapes.
7. **Don't refactor for refactor's sake.** The frontend is monolithic on purpose — keeping it as a single HTML/JS file is a stated constraint (no build step). Resist breaking it into modules.
8. **Commits.** Conventional commits (`feat:`, `fix:`, `refactor:`). Co-authors line for AI-assisted commits.
9. **Pull-request gate.** Tests must pass (`npm test`), `docker compose build` must succeed, and a manual smoke test of: (a) cache refresh, (b) generate ad-hoc report, (c) generate template report, (d) view patrol GPS map, (e) edit a municipality boundary.

---

## 19. Acceptance Checklist (use to verify a fresh rebuild)

- [ ] `npm install` is a no-op (zero deps) or installs nothing visible.
- [ ] `npm test` runs Node's test runner across `test/**/*.test.js` and all suites pass.
- [ ] `node server.js` listens on the configured port and serves `public/index.html`.
- [ ] `GET /api/health` returns `{ ok:true, earthranger:'ok' }` with valid env, else `unreachable`.
- [ ] `GET /api/patrols?source=cache&page=1&page_size=100` returns the cached patrols envelope even when EarthRanger is unreachable.
- [ ] Dashboard renders with filters defaulting to the current week.
- [ ] Active Patrols counters update without manual refresh (30s interval).
- [ ] Patrol Index table is horizontally scrollable; the bottom proxy scrollbar mirrors the content.
- [ ] "View" on a patrol row opens the GPS map modal and renders the polyline.
- [ ] "Manage Municipalities" opens the boundary editor with the 12 default rows, all marked Official, in Mindoro/Palawan groups.
- [ ] Selecting an Official municipality loads the ArcGIS Municipal_Waters preview as a dashed cyan line; copy-to-draft button transfers the geometry.
- [ ] Saving a custom override (≥3 vertices) flips `overrideOfficial=true` and the next report's Page 2 uses the override.
- [ ] "Generate Template Report" → opens a new tab with three pages; Page 3 lists only boundaries with KMS > 0, sorted desc, with "Est." badges where appropriate.
- [ ] Stopping and restarting the container preserves `data/patrol-cache.json` and `data/patrol-tracks/`.
- [ ] `POST /api/cache-refresh` returns updated sync stats and the dashboard re-renders.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| Patrol | An EarthRanger patrol record. Has one primary `segment` with `leader` (subject) + `time_range`. |
| Segment | A leg of a patrol with a leader subject and a start/end time. Index `[0]` is the canonical one for this app. |
| Track | A GeoJSON `FeatureCollection` of the subject's GPS positions for a segment's time range. Returned **newest-first** by EarthRanger. |
| Boundary | A municipality polygon or polyline used to attribute coverage. Can be official (ArcGIS) or custom (user-drawn). |
| Coverage KMS | Sum of haversine distances of all in-track segments whose midpoint nearest-falls within a boundary. |
| Coverage HRS | Sum of `Math.abs(dt)` between consecutive in-track points for those segments. Pro-rated when no per-point timestamps. |
| Deep sync | Background full-history pagination, every 10 min. |
| Active check | Background newest-N pagination + sync-candidate refresh, every 2 min. |
| Sync candidate | A cached patrol whose `syncNeeded` is true (open / active state or unfinished segment). |
| Sync engine | The pair of timers in `lib/patrol-sync.js`. |
| Track store | `data/patrol-tracks/<id>.json` + `data/patrol-tracks-index.json`. |
| Override | A user-drawn boundary that supersedes the official ArcGIS one for that municipality. Detected by `overrideOfficial=true` OR `≥3 coordinates`. |

---

## 21. AI Build Instructions

When asked to "rebuild this app" using this spec:

1. Read this whole document. Do not skim.
2. Scaffold files per §3 in the exact paths.
3. Wire `server.js` per §5 — route table, static fallback to `index.html`, then `startPatrolSync()` after `listen`.
4. Implement `lib/earthranger.js` per §7 first; write its tests; verify against a real EarthRanger if available.
5. Implement `lib/patrol-cache.js` per §8 (with the `writePromise` serialization).
6. Implement `lib/track-store.js` (§11), `lib/track-utils.js` (§10), `lib/async-pool.js` (§12), `lib/area-covered.js` (§10), then `lib/patrol-sync.js` (§9). Write tests at each step.
7. Implement the 9 API handlers per §6.
8. Build `public/index.html` per §13 in chunks: HTML skeleton + IDs → CSS for dashboard → JS for cache fetch / table render → filters → active patrols → boundary modal → GPS map modal → ad-hoc report → template report (with Pages 1, 2, 3).
9. Run `npm test` and the §19 acceptance checklist.
10. Build & run with `docker compose up --build` and confirm the dashboard is reachable on `:41739`.

**Do not invent features outside this spec.** The product is finished as described; new requirements must come through the user.

---

## 22. Operational Considerations

Things that are not features but determine whether the app stays alive in production. An AI rebuilding from this spec must read this section before declaring the rebuild "done".

### 22.1 Time & Time Zones

- All ISO timestamps are stored, compared, and transmitted in **UTC**.
- Local rendering happens at the view layer via `Intl.DateTimeFormat` / `toLocaleString` using the **browser's** zone — typically `Asia/Manila` (UTC+8) for the ops team.
- The "current week" default range (Monday–Sunday) is computed in **local browser time**, NOT UTC. A Monday 00:00 in Manila is `Sunday 16:00 UTC` in the API query — this is intentional so the user's "this week" feels right, at the cost of slight cross-day misalignment for non-Manila users.
- The Philippines does not observe DST, so day boundaries are stable. If deployed elsewhere, audit `getMonthWeekPeriods`, `setDefaultDateRange`, and the weekly/monthly/annual period builders.
- **Track time math uses `Math.abs(t1 - t0)`** (Constitution rule §1.9) because EarthRanger returns track points **newest-first** so adjacent time deltas can be negative. Every new piece of track math must comment this assumption.
- All `Date.parse` inputs must be ISO 8601 with explicit zone (`Z` or `±HH:MM`). Loose strings like `"2026-05-15"` parse as local midnight — never write them server-side.

### 22.2 Security Model

- **No app-level authentication.** Anyone with TCP access to port 41739 can:
  - View all patrol data, all GPS tracks, all municipality boundaries.
  - Call `POST /api/patrols` (creates ER patrols) and `PATCH /api/patrols-update` (edits ER patrols) — these proxy to ER with the server's token, so an attacker on the LAN can mutate ER data using ER's credentials.
  - Force `POST /api/cache-refresh` (cheap DoS vector — every call schedules ER work).
- The deployment threat model assumes the port is reachable **only over a trusted internal network or VPN**. Do not expose 41739 to the public internet.
- **The only secret in the system** is the EarthRanger credential set in `.env.local`. That file MUST NOT be committed (already `.gitignore`'d) and MUST NOT be baked into the Docker image (compose uses `env_file:`, not `ENV`).
- `data/patrol-cache.json` and `data/patrol-tracks/*` contain operational location data of rangers and protected sites; treat the host volume as **sensitive** (filesystem perms `0700` on `data/` is appropriate).
- No CSRF protection on mutating endpoints — by design, because there is no auth and the threat model is "trusted network". If a public-facing deployment is ever required, the correct order is: (1) put a reverse proxy with auth in front, (2) add CSRF tokens to mutating endpoints, (3) add per-origin CORS allowlist. Do NOT bolt auth into the app first.
- No CORS headers are set; browser same-origin policy is the only protection against cross-site fetches.
- Logs may include patrol titles and IDs — they are operational, not classified, but should not be shipped to a public log aggregator.

### 22.3 Data Growth & Capacity

Empirical sizing observed in the Blue Alliance deployment (Mindoro + Palawan, ~30 active patrols/week, ~1500 patrols/year):

| Artifact | Per-unit | Annual estimate | 5-year ceiling |
|---|---|---|---|
| Patrol cache entry | 3–8 KB JSON | 5–12 MB | 25–60 MB |
| Track file | 30–80 KB | 50–120 MB | 250–600 MB |
| Track index entry | ~200 B | 0.3 MB | 1.5 MB |
| `data/` total | — | ~150 MB/year | **~3 GB** |

Provision the host volume with **≥5 GB headroom**. Monitor `du -sh data/` from cron or a smoke check.

There is **no built-in archival or pruning.** To downsize manually:

```bash
# Remove track files older than N days; sync engine will not refetch closed patrols
find data/patrol-tracks/ -mtime +365 -delete
# (operator must then prune data/patrol-tracks-index.json by hand)
```

The in-process caches (`patrolTracksHandler`'s 10-minute TTL Map, `patrolKilometersHandler`'s unbounded Map) have no eviction beyond TTL. RSS grows with active table use but resets on container restart — acceptable because the container is small (≤200 MB RSS observed).

### 22.4 Backup & Restore

- The entire state is captured by tarring `data/`:
  ```bash
  tar czf backup-$(date +%F).tgz data/
  ```
- Restore: `docker compose down`, replace `data/` from tarball, `docker compose up -d`.
- A nightly snapshot job is recommended **on the host, not in-app**:
  ```cron
  0 2 * * * cd /opt/blue-alliance && tar czf /backups/era-$(date +\%F).tgz data/ && find /backups -name 'era-*.tgz' -mtime +30 -delete
  ```
- No DR replication is built in. The cache is rebuildable from EarthRanger via `npm run cache:backfill`, so worst-case recovery is "restart with empty `data/` and backfill" — hours to days depending on history depth.
- The patrol-cache file format is `version: 1`. If a future change bumps it, the backup/restore step does NOT need a migration (the normalizer self-heals); a downgrade does require restoring from the matching backup.

### 22.5 Observability

- Server logging: `console.log` / `console.error` only, collected by `docker compose logs -f earthranger-reporting-tool`.
- **`/api/sync-status` is the canonical liveness probe.** A healthy system has `lastDeepSync` within the last 10–15 minutes and `lastError === null`.
- **No metrics endpoint, no Prometheus exporter, no structured logging.** This is intentional (zero-deps rule). If observability is needed later, the correct retrofit is a single ~50-line `pino`-style structured logger inlined into `lib/log.js` rather than adding a runtime dep.
- The dashboard surfaces sync errors only via the "Refresh Cache" button's response. A future iteration should bind a small status pill to `/api/sync-status` so an operator notices `lastError` without clicking.
- For external uptime monitoring, hit `/api/health` from your monitoring system. It never throws and returns `200` with a status string — alert on `earthranger !== "ok"`.

### 22.6 Browser Support

- **Target:** latest two versions of Chrome, Edge, Firefox, Safari.
- The app uses `fetch`, `Intl.DateTimeFormat`, ES2020+ (`?.`, `??`, top-level `await` is NOT used), and Leaflet 1.9.4.
- **Mobile / tablet is not a target.** The patrol-index table assumes a desktop viewport (≥1280 px). It works on tablets in landscape but is not pleasant.
- **Printing:** the report tabs assume A4 / Letter / Legal sizes via `@page { size: ...; margin: 0; }`. Verified in Chromium print preview. Firefox renders the same. Safari has minor margin quirks — acceptable.
- **No offline support / no service worker / no PWA manifest.** Browser must be online to reach the same-origin API.
- **No accessibility audit.** The app does not target WCAG AA. Color choices have not been checked for contrast against the cyan boundary lines.

### 22.7 Concurrency & Multi-User

- The server is **single-process Node**. Multiple concurrent dashboard users share the same cache file, the same in-process TTL/km caches, and the same sync engine state.
- All disk writes serialize through `writePromise` (patrol cache) and per-file atomic temp+rename (tracks). A burst of concurrent `POST /api/cache-refresh` calls is safe but pointless — the sync mutex collapses them to one.
- There is no per-user state — no sessions, no cookies, no preferences. Every browser sees the same filters' initial defaults (`current week`) and the same data.
- Designed for ≤10 simultaneous users on a LAN. Beyond ~30 concurrent dashboards, the in-process km cache (unbounded) will start to dominate RSS — bound it with an LRU at that point.

### 22.8 Performance Ceilings (empirical)

- **Filtering / table render:** tested up to ~20 000 cached patrols. Filtering is in-memory and fast; DOM cost dominates above ~2 000 rendered rows, which is why the table paginates to `page_size`.
- **Area-covered aggregation:** dominated by track parse time. 1 000 patrols × ~500 points each ≈ 1.5 s on a recent laptop. Acceptable for the few-per-day report cadence.
- **Cold start to first usable dashboard:** <2 s when cache is warm, ~5–10 s during the on-startup deep-sync.
- **Map render:** Leaflet handles ~5 000 polyline points smoothly; beyond that, simplify (Douglas-Peucker) before rendering.

### 22.9 Code Modification Guardrails

These are *additional* rules on top of the §1 Build Constitution and §18 Governance, specifically about touching live-production code:

1. **Never edit `data/patrol-cache.json` by hand on a running container.** The serialized `writePromise` may overwrite your edit. Either stop the container or use `clearCache()` via a one-off script.
2. **Never bump the cache `version` without writing the migrator in `loadCache()`.** The normalizer is intentionally tolerant, but version skew across restarts is the one thing that can silently lose data.
3. **Never change `getPatrolKey`** without a migration that re-keys every existing entry. Patrol IDs are used as filenames in `data/patrol-tracks/`.
4. **Never block the event loop on disk I/O.** All file writes go through `fs/promises`. A synchronous `fs.writeFileSync` in any handler will tank concurrent requests.
5. **Never silently swallow EarthRanger errors.** Always log them and stamp `lastError`. The dashboard relies on `/api/sync-status` to see them.
6. **Never call `fetch` directly from a handler.** All ER traffic goes through `lib/earthranger.js` so auth/timeout/error normalization is consistent.

### 22.10 Things Explicitly Out of Scope (do not propose)

- Sign-in / user accounts / multi-tenancy.
- Cloud database (SQLite, Postgres, KV, S3, etc.). Filesystem is the database by design (Constitution §1.5).
- Bundlers, frameworks, TypeScript compilation, or any build step beyond `docker compose build`.
- Vercel, Cloudflare Workers, Edge Functions, or any serverless target. See memory `project_deployment.md`.
- WebSockets / SSE / long-polling. The 30-second `autoRefreshPatrols` is the only liveness mechanism.
- Push notifications, email, SMS, or any outbound communication.
- A REST API for external consumers. All endpoints under `/api/*` are private to the dashboard.

If a future requirement crosses one of these lines, it is a **new product**, not an extension of this one — fork or replace, do not bolt on.

---

## 23. Document Maintenance

This spec is the single source of truth and must remain accurate as the code evolves. Maintenance rules:

1. **When the code changes a load-bearing fact** (a constitution rule, an API contract, a cache shape, a sync interval, a default municipality, an external dependency) — update SPEC.md in the same PR. The PR title prefix `feat:` / `refactor:` implies "spec may need an update"; the reviewer checks.
2. **When the spec is wrong but the code is right** — update the spec, not the code. The code is the runtime truth; the spec describes the intent.
3. **Section numbering is stable.** New sections are appended (§24, §25, …). Cross-references like "§7.2" must keep pointing at the same content; if a section is rewritten, edit in place, do not renumber.
4. **Subsections may be added freely** (§7.4, §22.11, …) without renumbering siblings.
5. **A change to the Build Constitution (§1)** requires explicit user sign-off in the PR description — these 12 rules are the project's identity.
6. **Memory entries** (`memory/MEMORY.md` and its linked files) take precedence over SPEC.md when they disagree, because they are written closer to the moment of change. After resolving a disagreement, update SPEC.md to match the memory's truth, then the memory entry can be retired or marked "absorbed into spec".
