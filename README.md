# EarthRanger Reporting Tool (Vercel App)

Runnable Vercel app for EarthRanger data access, including patrol retrieval and management.

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

## Deploy to Vercel
1. Push this repo to GitHub.
2. Import project in Vercel.
3. Add the same env vars in Vercel Project Settings.
4. Deploy.
