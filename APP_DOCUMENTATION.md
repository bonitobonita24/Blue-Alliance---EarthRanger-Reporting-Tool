# Blue Alliance EarthRanger Reporting Tool

## What This App Is

The Blue Alliance EarthRanger Reporting Tool is a Docker-based local web app for viewing, filtering, caching, syncing, and reporting EarthRanger patrol records.

It connects to an EarthRanger server, stores patrol records locally, and presents patrol data in a dark-mode dashboard designed for Blue Alliance operations. The app is intended to make patrol review and reporting faster than repeatedly loading data from the EarthRanger website.

## Primary Goals

- Show patrol records in an Excel-like index table.
- Support fast filtering by date range, patrol type, status, tracker, text search, and time window.
- Show currently active patrols.
- Generate summary reports from filtered data.
- Store EarthRanger patrol data locally so the app can load quickly.
- Keep local patrol data synced with EarthRanger without forcing the user to manually reload.

## How It Runs

The intended runtime is Docker Desktop.

```bash
docker compose up --build -d
```

Open:

```text
http://localhost:41739
```

Stop:

```bash
docker compose down
```

The app intentionally uses host port `41739` to avoid common conflicts with other Docker containers.

## Main User Interface

### Active Patrols

At the top of the app, the Active Patrols section shows:

- Active Foot patrol count
- Active Seaborne patrol count
- Total Active patrol count
- Active Patrols List

Active patrols are counted only when:

- the patrol state is `open` or `active`, and
- the patrol has a started segment without an end time

Cancelled patrols with missing segment end times are not counted as active.

### Manage List

The left-side filter panel controls the Patrol index. It includes:

- Search
- Tracked by multi-select
- Patrol Type
- Status
- Sort
- From date
- To date
- Show only actively ongoing patrols
- Advanced start time window
- Generate Report
- Clear filters

### Patrol Index

The Patrol index is the main table. It displays:

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

The table uses the EarthRanger user-facing patrol number from `serial_number`, not the UUID.

The default Patrol index view is the most recent 7-day date range:

- `From`: six days before today
- `To`: today

The summary under the title reads like:

```text
34 results from May 7, 2026 to May 13, 2026
```

### Horizontal Scrolling

Because the table is wide, the app has a floating horizontal slider at the bottom of the visible browser screen. This lets the user move to right-side columns without scrolling to the bottom of the table. The native table horizontal scrollbar is hidden.

## Filtering Behavior

The app now uses the local cache first. Date filters do not trigger a slow EarthRanger harvest anymore.

Changing `From` and `To` instantly filters the locally cached patrol records.

Advanced start time window behavior:

- The date range controls which patrol start dates are considered.
- If the window is overnight, such as `10:00 PM` to `7:00 AM`, the app matches patrols that started from `10:00 PM` through `11:59 PM` on each selected date.
- It does not include patrols that started after midnight on the following day for the selected start date.

## Report Generation

The Generate Report button creates a report from the currently filtered and sorted patrol records.

The report includes:

- Header: `Blue Alliance`
- Title/coverage summary based on selected filters
- Total patrol count
- Subtotals by patrol type when applicable
- Total hours
- Total kilometers when distance data exists

## Local Data Cache

Cached data is stored at:

```text
./data/patrol-cache.json
```

Inside Docker it is mounted as:

```text
/app/data/patrol-cache.json
```

The `data/` folder is ignored by git.

Current observed cache size:

- about `16 MB`
- about `4,535` cached patrol records

## Sync Behavior

The Docker server starts a background sync loop.

Every minute, it:

1. Pulls the newest patrol window from EarthRanger:
   - 5 pages
   - 100 patrols per page
   - 500 newest records total

2. Refreshes cached patrols that still need sync:
   - open/active patrols
   - patrols with a started segment and no end time

This design catches patrols that start and end quickly between sync intervals, because the latest rolling window is always refreshed.

The browser also merges cached updates quietly every minute. It does not clear the table or reset the scroll position.

## Full History Backfill

To populate the local cache from EarthRanger:

```bash
docker compose exec earthranger-reporting-tool npm run cache:backfill
```

For smaller page requests:

```bash
docker compose exec -e PATROL_BACKFILL_PAGE_SIZE=100 earthranger-reporting-tool npm run cache:backfill
```

The backfill script retries transient EarthRanger failures. The cache writer uses atomic temp-file writes and merges with the current disk cache before saving.

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

Use:

```bash
curl -sS http://localhost:41739/api/sync-status
```

to inspect sync/cache status.

## Authentication

Credentials are read from environment variables, usually through `.env.local`.

Supported auth order:

1. `ER_TOKEN`
2. `ER_TRACK_TOKEN`
3. `DAS_WEB_TOKEN`
4. `ER_USERNAME` + `ER_PASSWORD`

Do not commit `.env.local` or real credentials.

## Important Implementation Files

- `public/index.html` - complete frontend UI and browser logic
- `server.js` - local Node HTTP server
- `api/patrols.js` - patrol API and cache-first endpoint
- `api/sync-status.js` - sync status and manual sync endpoint
- `lib/earthranger.js` - EarthRanger API client
- `lib/patrol-cache.js` - JSON file cache
- `lib/patrol-sync.js` - background sync loop
- `scripts/backfill-patrol-cache.js` - full history cache backfill
- `docker-compose.yml` - Docker runtime
- `Dockerfile` - container image

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

