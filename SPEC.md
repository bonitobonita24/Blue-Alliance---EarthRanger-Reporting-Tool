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
