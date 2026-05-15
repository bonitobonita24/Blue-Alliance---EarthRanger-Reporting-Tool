# Area Covered Metrics — Design Spec

**Date:** 2026-05-15
**Project:** Blue Alliance - EarthRanger Reporting Tool
**Status:** Approved design, ready for implementation planning

## Goal

Extend the generated template report with a new Page 3 — "Area Covered" — that reports
patrol effort by **where the GPS track actually traveled**, not just where the patrol started.

Page 2 ("Started From") stays as-is. Page 3 is additive.

This is the milestone described in `ACCOMPLISHMENT_REPORT.md` §"The Next Milestone: Area
Covered Metrics" and §"Proposed Algorithm For Area Covered".

## Why This Matters

Rangers often start from a shoreline municipality, then patrol into Apo Reef Park, Taytay,
Aborlan, etc. Counting patrols only by their start point under-credits the actual areas
covered. Page 3 fixes this by assigning every GPS segment of every selected patrol to its
nearest enabled boundary, and aggregating coverage KMS and coverage HRS per boundary.

## Out Of Scope

- Changes to Page 2 ("Started From"). It keeps its current header, table, raw chart, and
  variance chart.
- In-app Area Covered UI (Manage List screen). Page 3 only appears in the generated
  template report. Keeps blast radius small for this milestone.
- True polygon-based in/out classification using a shoreline dataset. Still using
  nearest-line classification for now. Coastline closure remains the next milestone after
  this one.

## Architecture Overview

Three new pieces:

1. **Server-side track cache** — persistent on-disk store of GPS tracks (with timestamps
   when available) for every cached patrol, refreshed by the existing sync engine.
2. **`/api/area-covered` endpoint** — accepts a date range, optional patrol ID list, and
   the enabled boundary set; returns per-boundary aggregates.
3. **Generated report Page 3** — new section in the template report HTML rendered from
   the aggregates returned by the endpoint.

```
EarthRanger API
   |
   v
lib/patrol-sync.js  --(GPS tracks per patrol)-->  data/patrol-tracks/{id}.json
   |                                              data/patrol-tracks-index.json
   v
data/patrol-cache.json (existing)
                                                  ^
                                                  |
                                            lib/area-covered.js
                                                  |
                                            POST /api/area-covered
                                                  |
                                            buildTemplateReportHtml()
                                                  |
                                            Generated report Page 3
```

## Section 1 — Data Pipeline & Sync

### Persistent track store

- `data/patrol-tracks/{patrol_id}.json` — the raw GeoJSON object returned by
  `getSubjectTracks(subjectId, since, until)`. Preserves
  `feature.properties.coordinateProperties.times` when EarthRanger provides it.
- `data/patrol-tracks-index.json` — per-patrol metadata used to decide whether a refetch
  is needed.

Index entry shape:

```json
{
  "<patrol_id>": {
    "fetched_at": "2026-05-15T06:00:00Z",
    "has_timestamps": true,
    "point_count": 482,
    "last_track_time": "2026-05-10T17:22:00Z",
    "patrol_ended": true,
    "subject_id": "...",
    "since": "2026-05-04T00:00:00Z",
    "until": "2026-05-10T18:00:00Z"
  }
}
```

`patrol_ended` is set from `patrol_segments[0].time_range.end_time` at the moment the
track was fetched.

### Sync engine changes (`lib/patrol-sync.js`)

After each patrol is upserted into `data/patrol-cache.json`:

- If `patrol.patrol_segments[0].time_range.end_time` exists AND the patrol already has an
  index entry with `patrol_ended: true` → **skip the fetch**. Ended patrols' tracks do
  not change.
- Otherwise → fetch via `getSubjectTracks(subjectId, since, until)`, write the file
  atomically (write to `.tmp`, then rename), update the index entry.

Concurrency control:

- Fetches are paced through a small async pool (target: 4 in-flight max) to avoid
  hammering EarthRanger.
- On server start, after the initial deep sync completes, a one-time backfill pass
  ensures every cached patrol has tracks on disk.
- Subsequent ticks behave as documented above (`active-check` 2 min only re-fetches
  patrols without `patrol_ended: true`; `deep-sync` 10 min walks the full list but still
  skips ended-with-cached).

### `/api/patrol-tracks` endpoint update

- First tries the on-disk file. If present, returns it immediately (with the existing
  10-min in-memory hot cache wrapped on top to skip disk reads on hot repeated calls).
- Falls back to a live `getSubjectTracks` call only when the file is missing (defensive
  path; the sync should normally have populated it).
- The in-memory hot cache is invalidated when the disk file is rewritten by the sync.

## Section 2 — Algorithm & Computation

### Module `lib/area-covered.js`

Pure function:

```
aggregateAreaCovered({ patrolIds, boundaries }) =>
  { aggregates, missing_tracks, generated_at }
```

Inputs:

- `patrolIds: string[]` — patrol IDs to include.
- `boundaries: Array<{ id, name, geometry, geometryType }>` — the enabled boundary set
  (same shape currently used by Page 2's `municipalityReportData`).

For each patrol:

1. Load the cached track from `data/patrol-tracks/{id}.json`. If missing → push id to
   `missing_tracks`, continue.
2. Flatten all `LineString`/`MultiLineString` features into one ordered coordinate
   array. Reuse extraction logic equivalent to `extractCoordinates` in
   `api/patrol-kilometers.js`.
3. Build a parallel `times[]` array by reading each feature's
   `properties.coordinateProperties.times`. If **any** feature lacks `times` of matching
   length → set `patrolHasTimestamps = false` for this patrol.
4. Walk consecutive coordinate pairs `(a, b)`:
   - `segKm = haversineKm(a, b)`
   - `mid = midpoint(a, b)`
   - `segBoundary = nearestBoundary(mid, boundaries)` using nearest-line/edge distance,
     no distance threshold (mirrors current Started-From semantics). Reuses the same
     point-to-line distance logic that `buildMunicipalityRows` uses today.
   - `segHrs = patrolHasTimestamps ? (times[i+1] - times[i]) / 3.6e6 : null`
5. After walking all segments for the patrol:
   - If `patrolHasTimestamps` → sum the real `segHrs` per boundary.
   - Else → distribute the patrol's reported `total_hrs` (derived from
     `time_range.end_time - time_range.start_time`) proportionally:
     `boundary_hrs = total_hrs * (boundary_km / patrol_total_km)`.
6. Accumulate per boundary:
   - `coverage_patrols` increments by 1 for the boundary if the patrol contributed any
     segment to it.
   - `coverage_km` sums segment kilometers.
   - `coverage_hrs` sums per-segment hours.
   - `hrs_estimated_count` increments by 1 if this patrol used the fallback path.
   - `hrs_actual_count` increments by 1 if this patrol used real timestamps.

### Endpoint `POST /api/area-covered`

Request body:

```json
{
  "from": "2026-05-04T00:00:00Z",
  "to":   "2026-05-10T23:59:59Z",
  "patrolIds": ["..."],
  "boundaries": [
    { "id": "...", "name": "Apo Reef Park", "geometry": { ... }, "geometryType": "LineString" }
  ]
}
```

- `patrolIds` is optional. If omitted, the server derives the list from the cache using
  the same date-range/timezone logic the rest of the app uses (see the May 13 timezone
  fix in `lib/patrol-sync.js` / `lib/patrol-cache.js`).
- `boundaries` is required. Boundaries currently live in browser localStorage; the
  client passes the enabled set explicitly.

Response body:

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

`hrs_estimated_count > 0` for a boundary → UI shows an "Est." indicator next to its HRS.

## Section 3 — UI / Report Page 3

### Layout

```
+-----------------------------------------------------------+
|                    AREA COVERED                            |
|         (matches Page 2 header design system)              |
+-----------------------------------------------------------+
|                                                            |
|  +--------------------------------------------------+      |
|  | Boundary       | Cov. Patrols | KMS    | HRS     |      |
|  |----------------|--------------|--------|---------|      |
|  | Apo Reef Park  |       9      | 142.3  | 27.8    |      |
|  | Taytay         |       4      |  63.1  | 11.2    |      |
|  | Aborlan        |       2      |  18.6  |  3.4 i  |      |
|  | ...            |     ...      |  ...   | ...     |      |
|  +--------------------------------------------------+      |
|                                                            |
|  +----------------------------+                            |
|  |   Coverage KMS bar chart   |                            |
|  |   (one bar per boundary)   |                            |
|  +----------------------------+                            |
|                                                            |
|  Note: HRS values marked "i" are distance-weighted         |
|  estimates because EarthRanger did not return per-point    |
|  timestamps for one or more contributing patrols.          |
|                                                            |
|  Patrols with missing GPS tracks: 3 (excluded from totals) |
+-----------------------------------------------------------+
```

### Rules

- Page 3 shows **only enabled boundaries that received at least one segment**. Empty
  rows are hidden. (Page 2 keeps showing every enabled boundary.)
- Rows sorted by Coverage KMS descending.
- One chart only: Coverage KMS bar chart. No variance chart on Page 3 — keep it focused.
- HRS column shows an "Est." indicator (small badge/icon) when
  `hrs_estimated_count > 0` for that boundary. Footer note explains.
- If `missing_tracks.length > 0`, footer line shows the count.

### Wiring in `public/index.html`

- `buildTemplateReportHtml(report)` makes a `POST /api/area-covered` call with the same
  boundary set already used for Page 2 (`getMunicipalityReportData()`).
- The aggregates payload is serialized into the generated report HTML via
  `escapeScriptJson` — same pattern as `municipalityJson`.
- Inside the generated report HTML, a new renderer function (working name
  `renderAreaCoveredPage(aggregates, missing)`) builds Page 3 DOM. It uses the same
  chart helper(s) Page 2 uses for visual consistency.
- Page 2 markup and code are untouched.

## Edge Cases

- **Patrol with no track file** → not counted toward any boundary's coverage; id added
  to `missing_tracks` and surfaced in the Page 3 footer count.
- **Single-point track** (zero segments) → contributes 0 km, 0 hrs to all boundaries.
- **Mixed-timestamp track** (some features have `times`, some don't) → the patrol is
  treated as estimate (`patrolHasTimestamps = false`).
- **Patrol with zero total km** but non-zero total hrs (degenerate) → its hrs are not
  distributed (avoids divide-by-zero).
- **Boundary disabled or deleted after fetch** → not in the request payload, so it
  simply doesn't appear in the result. No reconciliation needed.

## Verification

After each implementation step:

```bash
node --check server.js
```

```bash
node - <<'NODE'
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('<script>');
const end = html.lastIndexOf('</script>');
new vm.Script(html.slice(start + '<script>'.length, end));
console.log('inline script parsed');
NODE
```

Manual smoke after rebuild:

```bash
docker compose up -d --build
```

1. Confirm `data/patrol-tracks/` populates after a server start.
2. Generate the template report for May 4–10, 2026.
3. Confirm Page 3 appears, sorts by KMS desc, hides empty rows.
4. Confirm Coverage KMS totals reconcile sanely against patrol total KMS.
5. Pick at least one patrol whose tracks include timestamps and one that does not;
   confirm "Est." indicator only appears on the right boundaries.

## Affected Files (Expected)

New:

- `lib/area-covered.js`
- `api/area-covered.js`
- `data/patrol-tracks/` (runtime, gitignored)
- `data/patrol-tracks-index.json` (runtime, gitignored)

Modified:

- `lib/patrol-sync.js` — adds track fetch + index maintenance.
- `api/patrol-tracks.js` — reads disk cache first.
- `server.js` — routes `POST /api/area-covered`.
- `public/index.html` — calls the new endpoint, renders Page 3.

## Status

Design approved by the user on 2026-05-15. Implementation plan to be authored next.
