# EarthRanger Reporting Tool

Docker-ready EarthRanger reporting app for patrol retrieval, filtering, and reporting.

## Agent Handover / Milestone Notes

- [`ACCOMPLISHMENT_REPORT.md`](ACCOMPLISHMENT_REPORT.md) — May 15, 2026 milestone report for future AI agents, Claude Code, and maintainers. Covers the report-template work, municipality patrol analytics, current implementation details, and the proposed next milestone for full track-based area coverage metrics.

## Endpoints
- `GET /api/health` — tests connectivity using `/subjects/?page_size=1`
- `GET /api/events?page_size=10` — fetch recent events
- `GET /api/patrols?page_size=25` — list patrols
- `POST /api/patrols` — create patrol (JSON body)
- `PATCH /api/patrols-update?patrol_id=<id>` — update an existing patrol (JSON body)

## Auth Modes
The app tries auth in this order:
1. `ER_TOKEN`
2. `ER_TRACK_TOKEN`
3. `DAS_WEB_TOKEN`
4. Basic auth with `ER_USERNAME` + `ER_PASSWORD`

## Setup
1. `cp .env.example .env.local`
2. Fill credentials/tokens in `.env.local`
3. `npm install`
4. `npm run dev`

## Run With Docker Desktop
1. Make sure Docker Desktop is running.
2. Keep your EarthRanger credentials in `.env.local`.
3. Run `docker compose up --build`.
4. Open `http://localhost:41739`.

Use `docker compose down` to stop the local container.

## Local Patrol Cache
The Docker app saves fetched patrols to `./data/patrol-cache.json`. A background sync runs every minute and refreshes the newest patrol window plus cached patrols that are still active/open or missing an end time. By default, the newest window is 5 pages of 100 patrols, so short patrols that start and end between sync ticks are still captured as new records. Completed patrols outside that newest window remain cached and are not repeatedly synced.

- `GET /api/sync-status` — inspect cache and sync status
- `POST /api/sync-status` — run a manual sync now

To backfill the local cache with the full patrol history:

```bash
docker compose exec earthranger-reporting-tool npm run cache:backfill
```
