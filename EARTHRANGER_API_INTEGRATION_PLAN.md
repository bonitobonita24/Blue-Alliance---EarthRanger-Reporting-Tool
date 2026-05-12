# EarthRanger API Integration Plan (for Blue Alliance Reporting Tool)

## Sources reviewed
- EarthRanger Support: **Interact with EarthRanger using the API**
- EarthRanger Support: **API Developer Guide (Gundi API)**
- GitHub sample client: **PADAS/er-client**
- EarthRanger interactive docs: `/api/v1.0/docs/interactive/`

## 1) Connection model

EarthRanger exposes a REST API under:

- `https://<your-server>.pamdas.org/api/v1.0/`

Authentication is Bearer-token based on the support docs; include:

- `Authorization: Bearer <TOKEN>`
- `Accept: application/json`

The docs indicate token generation in the EarthRanger admin portal (long-lived token recommended for integrations).

## 2) Minimal connectivity check for our app

Start by implementing a health/connectivity check that calls one read endpoint with small pagination:

- `GET /api/v1.0/subjects?page_size=1`

If this returns HTTP 200 and JSON payload with expected envelope (`count`, `results` in list endpoints), credentials and base URL are valid.

## 3) Suggested phased integration for this app

### Phase A — Read-only ingestion
- Pull data from:
  - Events: `GET /activity/events/`
  - Observations: `GET /observations/`
  - Subjects: `GET /subjects/`
- Implement:
  - Pagination support (`next` links or page params)
  - Date-window filters (`since`, `until`, `updated_since`)
  - Retry/backoff for 429/5xx

### Phase B — Write-back (if needed)
- Post reports/events: `POST /activity/events/`
- Post sensor observations: `POST /observations/`
- Add idempotency strategy in app layer (dedupe keys such as external_id + timestamp).

### Phase C — Production hardening
- Token rotation process
- Structured logs with request IDs
- Dead-letter queue for failed outbound writes
- Metrics: success rate, latency, rate-limit incidents

## 4) Practical implementation patterns

### Option 1: Direct HTTP (language-agnostic)
Use your preferred HTTP client and centralize:
- Base URL
- Auth headers
- Timeout/retry
- Pagination iterator

### Option 2: Python `er-client` (fastest for Python services)
`PADAS/er-client` demonstrates:
- `ERClient` / `AsyncERClient`
- posting observations/events
- event and observation retrieval

From the project README usage examples, initialization includes values like:
- `service_root="https://sandbox.pamdas.org"`
- authentication fields such as `client_id` + username/password in shown example

Because auth approaches can vary by deployment/version, verify against your server’s current interactive docs and admin-configured auth settings before coding production auth flow.

## 5) Configuration contract for our app

Define these environment variables:

- `ER_BASE_URL` (e.g., `https://<server>.pamdas.org/api/v1.0`)
- `ER_TOKEN` (Bearer token; stored in secret manager)
- `ER_TIMEOUT_SECONDS` (default 30)
- `ER_PAGE_SIZE` (default 200, tune as needed)
- `ER_MAX_RETRIES` (default 5)

Optional:
- `ER_VERIFY_SSL=true|false` (prefer true)
- `ER_PROXY_URL`

## 6) Example request templates

### cURL
```bash
curl "$ER_BASE_URL/activity/events/?page_size=50&sort_by=-updated_at" \
  -H "Authorization: Bearer $ER_TOKEN" \
  -H "Accept: application/json"
```

### Pseudocode ingestion loop
```text
url = ER_BASE_URL + "/activity/events/?updated_since=<cursor>&page_size=200"
while url:
  resp = GET(url, headers=auth_headers)
  process(resp.results)
  url = resp.next
save_new_cursor(max(updated_at))
```

## 7) Data mapping notes for reporting tool

For reporting-focused workloads, capture and normalize at minimum:

- Event: `id`, `serial_number`, `event_type`, `state`, `time`, `updated_at`, `location`, `title`
- Observation: `id`, `subject`, `recorded_at`, `location`, `source`
- Subject: `id`, `name`, `subject_type`, `updated_at`

Persist raw JSON as an audit column/blob so schema additions from EarthRanger do not break ingestion.

## 8) Risks / gotchas

- API fields and auth modes may differ between EarthRanger versions/instances.
- Interactive docs endpoint may require authenticated session and may render best in browser.
- Large backfills can hit rate limits; use chunked date ranges and throttling.

## 9) Recommended next action for this repo

Implement an `EarthRangerApiClient` module with:

1. Token-based auth header injection
2. Generic paginated GET helper
3. Endpoints: `get_events`, `get_observations`, `get_subjects`
4. A `test_connection()` startup check

Then wire it into reporting jobs with incremental cursors (`updated_since`).
