# Handover For Claude Sonnet 4.6

This handover explains the current state of the Blue Alliance EarthRanger Reporting Tool so another AI can continue without needing the full chat history.

## Project Summary

This is a Docker-first local web app for EarthRanger patrol reporting. It connects to an EarthRanger server, caches patrol data locally, keeps active patrols synced, and provides a dark-mode dashboard with filters, an active patrol summary, an Excel-like Patrol index, and report generation.

The user wants the app to feel like a real operational reporting tool, not a simple API demo.

## Runtime

Working directory:

```text
/home/me/UbuntuDevFiles/BlueAlliance/apps/Blue-Alliance---EarthRanger-Reporting-Tool
```

Run:

```bash
docker compose up --build -d
```

Open:

```text
http://localhost:41739
```

Docker details:

- Compose project: `blue-alliance-earthranger-reporting-tool`
- Container: `blue-alliance-earthranger-reporting-tool-app`
- Host port: `41739`
- Cache mount: `./data:/app/data`

Avoid changing to common ports like `3000`, `5432`, `6379`, etc.

## Security Notes

Real credentials must stay out of docs and commits.

Credentials live in `.env.local`, which is ignored by git. Use `.env.example` only for safe placeholders.

Supported auth order:

1. `ER_TOKEN`
2. `ER_TRACK_TOKEN`
3. `DAS_WEB_TOKEN`
4. `ER_USERNAME` + `ER_PASSWORD`

## Current Files And Responsibilities

- `public/index.html`
  - Entire frontend UI
  - Dark mode styling
  - Active patrol cards/list
  - Manage list filters
  - Patrol index table
  - Floating horizontal table slider
  - Report generation

- `server.js`
  - Dependency-free local Node HTTP server
  - Serves `public/`
  - Routes `/api/*` to Vercel-style handlers
  - Starts background patrol sync

- `api/patrols.js`
  - Live EarthRanger patrol fetch
  - Cache-first mode with `source=cache`
  - Saves fetched live patrols into cache
  - Falls back to cache if EarthRanger fetch fails

- `api/sync-status.js`
  - `GET` sync/cache status
  - `POST` manual sync now

- `lib/earthranger.js`
  - EarthRanger API client
  - Handles base URL, auth, timeout, fetch wrappers

- `lib/patrol-cache.js`
  - File-backed JSON cache
  - Path: `/app/data/patrol-cache.json`
  - Host file: `./data/patrol-cache.json`
  - Atomic temp-file writes
  - Merges with disk cache before saving to avoid overwrites

- `lib/patrol-sync.js`
  - One-minute background sync
  - Pulls latest rolling window
  - Refreshes open/active patrols or missing-end patrols

- `scripts/backfill-patrol-cache.js`
  - Full history backfill
  - Retries transient EarthRanger/socket failures

- `docker-compose.yml`
  - Runtime environment and volume

## Current App Behavior

### Default View

The Patrol index defaults to the last 7 days:

- From: six days before today
- To: today

The summary under Patrol index now reads:

```text
34 results from May 7, 2026 to May 13, 2026
```

It does not show the full cached total in the UI, because the user does not want to expose all historical records immediately.

### Cache-First Loading

The browser loads from:

```text
/api/patrols?source=cache&page_size=10000&page=1&sort_by=-start_time
```

This loads cached records immediately. Date filtering is done in the browser from cached records. It no longer triggers the old slow EarthRanger date-range harvest.

### Browser Auto Update

The browser merges cached updates every minute without clearing the table. It preserves vertical and horizontal scroll position. This was added because the previous literal refresh reset the user to the top of the Patrol index while scrolling.

### Server Auto Sync

The server runs `runPatrolSync()` every minute.

Default sync settings:

```yaml
PATROL_SYNC_INTERVAL_MS: 60000
PATROL_SYNC_LATEST_PAGE_SIZE: 100
PATROL_SYNC_LATEST_PAGES: 5
```

This pulls the newest 500 patrol records every minute. This matters because a ranger can start and end a patrol between sync ticks; the newest rolling window still catches those records.

It also refreshes sync candidates:

- active/open patrols
- patrols with started segments and no end time

### Active Patrol Counting

Important recent fix:

The app previously counted any segment with `start_time` and no `end_time`, including cancelled historical/test patrols. That caused the active count to show 10 when EarthRanger showed 3.

The frontend `isOngoingPatrol()` was tightened:

```js
const state = String(item.state || '').toLowerCase();
if (!['open', 'active'].includes(state)) return false;
```

Then it checks for started segment with no end time.

Keep this rule aligned with EarthRanger’s active display. If active count differs again, inspect cached patrols by state and segment end times.

### Patrol Index

Columns:

- Patrol ID
- Patrol Type
- Patrol Title
- Tracked By
- Objective / Details
- Total Hours
- Start Date
- End Date
- Start Location
- End Location

Patrol ID must use `serial_number` first, because EarthRanger’s visible ID is the serial number, not the UUID.

Start and End Date include year.

Data cells are nowrap. Horizontal navigation is handled by a floating screen-bottom horizontal slider aligned with the Patrol index. The native in-table horizontal scrollbar is hidden.

### Manage List Filters

Current filters:

- Search
- Tracked by chips
- Patrol type
- Status
- Sort
- From
- To
- Show only actively ongoing patrols
- Advanced start time window

The date filter labels were shortened from `Start date from` / `Start date to` to `From` / `To`.

### Advanced Time Window

For overnight patrol filtering, the intended behavior is:

- Date range selects patrol start dates to include.
- A time window like `10:00 PM` to `7:00 AM` only matches starts from `10:00 PM` through `11:59 PM` on each selected date.
- It does not include patrols that start after midnight on the next day for that selected date.

## Cache Status

Current observed cache:

- File: `./data/patrol-cache.json`
- Size: about `16 MB`
- Current cache endpoint showed about `4,535` patrols
- `syncNeeded` recently showed `15`

Use:

```bash
curl -sS http://localhost:41739/api/sync-status
```

and:

```bash
curl -sS 'http://localhost:41739/api/patrols?source=cache&page_size=5&page=1&sort_by=-start_time'
```

## Full Backfill

Run:

```bash
docker compose exec earthranger-reporting-tool npm run cache:backfill
```

Safer smaller pages:

```bash
docker compose exec -e PATROL_BACKFILL_PAGE_SIZE=100 earthranger-reporting-tool npm run cache:backfill
```

Notes:

- EarthRanger can close sockets mid-backfill; retry logic exists.
- EarthRanger pagination can return overlapping/duplicate patrol keys while live data changes.
- The cache stores unique patrol keys, so cached unique count can be slightly lower than paged row count.

## API Endpoints

```text
GET  /api/health
GET  /api/events
GET  /api/patrols
GET  /api/patrols?source=cache
POST /api/patrols
PATCH /api/patrols-update?patrol_id=<id>
GET  /api/sync-status
POST /api/sync-status
```

## Verification Commands

```bash
node --check server.js
node --check api/patrols.js
node --check api/sync-status.js
node --check lib/patrol-cache.js
node --check lib/patrol-sync.js
node --check scripts/backfill-patrol-cache.js
docker compose up --build -d
curl -sS http://localhost:41739/api/health
curl -sS http://localhost:41739/api/sync-status
```

Frontend script parse check:

```bash
node - <<'NODE'
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
new Function(script);
console.log('script parses ok');
NODE
```

## Known Risks And Improvement Ideas

- `public/index.html` is large and contains all frontend code. Future maintainers should be careful with duplicated helper logic.
- JSON cache is acceptable at current size, but SQLite would be better if more indexing or concurrent access is needed.
- Consider adding an in-app sync timestamp indicator.
- Consider an admin/backfill endpoint with progress reporting instead of only CLI backfill.
- If active counts differ from EarthRanger, first inspect state values and segment end times in cached records.

