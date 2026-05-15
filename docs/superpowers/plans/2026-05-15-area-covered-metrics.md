# Area Covered Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Page 3 to the generated template report ("Area Covered") that aggregates KMS and HRS per monitored boundary based on each patrol's actual GPS track, backed by a server-side track cache and a new `/api/area-covered` endpoint.

**Architecture:** Background sync engine fetches and persists per-patrol GPS tracks (with timestamps when EarthRanger provides them) to `data/patrol-tracks/{id}.json`. A pure aggregation module (`lib/area-covered.js`) walks segments, assigns each to its nearest enabled boundary, and sums KMS/HRS — using real elapsed time when timestamps exist, distance-weighted estimates otherwise. The generated report HTML calls `POST /api/area-covered` for the same boundary set already used by Page 2 and renders Page 3 from the returned aggregates. Page 2 is untouched.

**Tech Stack:** Node.js 20+ (ESM), node:fs/promises, node:test, vanilla browser JS. No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-05-15-area-covered-metrics-design.md`

---

## File Structure

**New files:**
- `lib/track-utils.js` — pure helpers: `extractCoordinates`, `extractCoordinatesWithTimes`, `haversineKm`, `midpoint`, `pointToLineDistanceKm`, `nearestBoundary`.
- `lib/track-store.js` — disk persistence for tracks + index, with atomic writes.
- `lib/area-covered.js` — `aggregateAreaCovered({ patrolIds, boundaries })` orchestrator.
- `lib/async-pool.js` — tiny concurrency-limited promise pool helper.
- `api/area-covered.js` — POST endpoint handler.
- `test/track-utils.test.js`
- `test/track-store.test.js`
- `test/area-covered.test.js`
- `test/async-pool.test.js`

**Modified files:**
- `package.json` — add `test` script.
- `api/patrol-kilometers.js` — switch to shared `track-utils` for extraction + haversine.
- `api/patrol-tracks.js` — read from `track-store` first, fall back to live EarthRanger fetch.
- `lib/patrol-sync.js` — after upserting patrols, enqueue track fetches via the async pool, skip ended-with-cached.
- `server.js` — register POST `/api/area-covered`.
- `public/index.html` — in `buildTemplateReportHtml`, POST to `/api/area-covered`, embed aggregates, render Page 3.

**Runtime data (gitignored — `data/` is already in `.gitignore`):**
- `data/patrol-tracks/{patrol_id}.json`
- `data/patrol-tracks-index.json`

---

## Task 1: Test infrastructure

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `test` script**

Edit `package.json` `scripts` block. After change, the `scripts` object should be:

```json
"scripts": {
  "dev": "node server.js",
  "start": "node server.js",
  "test": "node --test test/",
  "cache:backfill": "node scripts/backfill-patrol-cache.js",
  "docker:up": "docker compose up --build",
  "docker:down": "docker compose down"
}
```

- [ ] **Step 2: Create empty test directory placeholder**

```bash
mkdir -p test
```

- [ ] **Step 3: Verify the runner works on an empty suite**

Run: `npm test`
Expected: exits 0 with output like `# tests 0` or "no tests found" (no error).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add node:test runner script"
```

---

## Task 2: `lib/track-utils.js` — coordinate + timestamp extraction

**Files:**
- Create: `lib/track-utils.js`
- Test: `test/track-utils.test.js`

- [ ] **Step 1: Write failing tests for `extractCoordinates`**

Create `test/track-utils.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCoordinates, extractCoordinatesWithTimes } from '../lib/track-utils.js';

test('extractCoordinates flattens a FeatureCollection of LineStrings', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[5, 6], [7, 8]] } }
    ]
  };
  assert.deepEqual(extractCoordinates(fc), [[1, 2], [3, 4], [5, 6], [7, 8]]);
});

test('extractCoordinates handles a single Feature with MultiLineString', () => {
  const feat = {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]], [[5, 6]]] }
  };
  assert.deepEqual(extractCoordinates(feat), [[1, 2], [3, 4], [5, 6]]);
});

test('extractCoordinates returns [] for null/empty input', () => {
  assert.deepEqual(extractCoordinates(null), []);
  assert.deepEqual(extractCoordinates({}), []);
  assert.deepEqual(extractCoordinates({ type: 'FeatureCollection', features: [] }), []);
});

test('extractCoordinatesWithTimes pairs coords with parsed timestamps', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
      properties: {
        coordinateProperties: { times: ['2026-05-04T10:00:00Z', '2026-05-04T10:05:00Z'] }
      }
    }]
  };
  const { coordinates, times, hasTimestamps } = extractCoordinatesWithTimes(fc);
  assert.deepEqual(coordinates, [[1, 2], [3, 4]]);
  assert.equal(times.length, 2);
  assert.equal(times[0], Date.parse('2026-05-04T10:00:00Z'));
  assert.equal(times[1], Date.parse('2026-05-04T10:05:00Z'));
  assert.equal(hasTimestamps, true);
});

test('extractCoordinatesWithTimes flags hasTimestamps=false when any feature lacks times', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
        properties: { coordinateProperties: { times: ['2026-05-04T10:00:00Z', '2026-05-04T10:05:00Z'] } }
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[5, 6], [7, 8]] }
      }
    ]
  };
  const { coordinates, hasTimestamps } = extractCoordinatesWithTimes(fc);
  assert.deepEqual(coordinates, [[1, 2], [3, 4], [5, 6], [7, 8]]);
  assert.equal(hasTimestamps, false);
});

test('extractCoordinatesWithTimes flags hasTimestamps=false when times length mismatches coords', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4], [5, 6]] },
      properties: { coordinateProperties: { times: ['2026-05-04T10:00:00Z', '2026-05-04T10:05:00Z'] } }
    }]
  };
  const { hasTimestamps } = extractCoordinatesWithTimes(fc);
  assert.equal(hasTimestamps, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/track-utils.js` (extraction only)**

Create `lib/track-utils.js`:

```javascript
export function extractCoordinates(track) {
  if (!track) return [];
  if (track.type === 'FeatureCollection' && Array.isArray(track.features)) {
    const out = [];
    for (const feature of track.features) out.push(...coordsFromGeom(feature?.geometry));
    return out;
  }
  if (track.type === 'Feature') return coordsFromGeom(track.geometry);
  if (Array.isArray(track.coordinates)) return track.coordinates;
  return [];
}

function coordsFromGeom(geom) {
  if (!geom || !geom.coordinates) return [];
  if (geom.type === 'LineString') return geom.coordinates;
  if (geom.type === 'MultiLineString') return geom.coordinates.flat();
  if (geom.type === 'Point') return [geom.coordinates];
  return [];
}

export function extractCoordinatesWithTimes(track) {
  const coordinates = [];
  const times = [];
  let hasTimestamps = true;

  const features = trackFeatures(track);
  if (!features.length) return { coordinates: [], times: [], hasTimestamps: false };

  for (const feature of features) {
    const coords = coordsFromGeom(feature.geometry);
    const rawTimes = feature?.properties?.coordinateProperties?.times;

    if (!Array.isArray(rawTimes) || rawTimes.length !== coords.length) {
      hasTimestamps = false;
      coordinates.push(...coords);
      for (let i = 0; i < coords.length; i++) times.push(null);
      continue;
    }

    for (let i = 0; i < coords.length; i++) {
      coordinates.push(coords[i]);
      const parsed = Date.parse(rawTimes[i]);
      if (Number.isNaN(parsed)) { hasTimestamps = false; times.push(null); }
      else times.push(parsed);
    }
  }

  return { coordinates, times, hasTimestamps };
}

function trackFeatures(track) {
  if (!track) return [];
  if (track.type === 'FeatureCollection' && Array.isArray(track.features)) return track.features;
  if (track.type === 'Feature') return [track];
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/track-utils.js test/track-utils.test.js
git commit -m "feat: add track-utils coordinate and timestamp extraction"
```

---

## Task 3: `lib/track-utils.js` — geometry math

**Files:**
- Modify: `lib/track-utils.js`
- Modify: `test/track-utils.test.js`

- [ ] **Step 1: Append failing tests**

Append to `test/track-utils.test.js`:

```javascript
import {
  haversineKm,
  midpoint,
  pointToLineDistanceKm,
  nearestBoundary
} from '../lib/track-utils.js';

test('haversineKm zero distance for identical point', () => {
  assert.equal(haversineKm([121.0, 13.0], [121.0, 13.0]), 0);
});

test('haversineKm ~ 111 km for 1 degree of latitude', () => {
  const km = haversineKm([121.0, 13.0], [121.0, 14.0]);
  assert.ok(km > 110 && km < 112, `expected ~111, got ${km}`);
});

test('midpoint returns average of two points', () => {
  assert.deepEqual(midpoint([0, 0], [2, 4]), [1, 2]);
});

test('pointToLineDistanceKm: point on the line is ~0', () => {
  const line = [[0, 0], [0, 2]];
  const d = pointToLineDistanceKm([0, 1], line);
  assert.ok(d < 0.001, `expected ~0, got ${d}`);
});

test('pointToLineDistanceKm: perpendicular point returns ~111 km for 1 degree at equator', () => {
  const line = [[0, 0], [0, 1]];
  const d = pointToLineDistanceKm([1, 0.5], line);
  assert.ok(d > 100 && d < 120, `expected ~111, got ${d}`);
});

test('nearestBoundary picks the closer line', () => {
  const boundaries = [
    { id: 'A', name: 'A', geometryType: 'LineString', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 2]] } },
    { id: 'B', name: 'B', geometryType: 'LineString', geometry: { type: 'LineString', coordinates: [[10, 0], [10, 2]] } }
  ];
  assert.equal(nearestBoundary([0.5, 1], boundaries).id, 'A');
});

test('nearestBoundary returns null on empty input', () => {
  assert.equal(nearestBoundary([0, 0], []), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `haversineKm` etc. not exported.

- [ ] **Step 3: Append geometry math to `lib/track-utils.js`**

Append:

```javascript
const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a, b) {
  if (!a || !b) return 0;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function pointToLineDistanceKm(point, lineCoords) {
  if (!Array.isArray(lineCoords) || lineCoords.length < 2) {
    if (lineCoords?.length === 1) return haversineKm(point, lineCoords[0]);
    return Infinity;
  }
  let min = Infinity;
  for (let i = 1; i < lineCoords.length; i++) {
    const d = segmentDistanceKm(point, lineCoords[i - 1], lineCoords[i]);
    if (d < min) min = d;
  }
  return min;
}

function segmentDistanceKm(p, a, b) {
  const latRef = (a[1] + b[1]) / 2;
  const scale = Math.cos((latRef * Math.PI) / 180);
  const toXY = ([lon, lat]) => [lon * scale, lat];
  const [px, py] = toXY(p);
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const projLon = projX / scale;
  return haversineKm(p, [projLon, projY]);
}

export function nearestBoundary(point, boundaries) {
  if (!Array.isArray(boundaries) || boundaries.length === 0) return null;
  let best = null;
  let bestKm = Infinity;
  for (const b of boundaries) {
    for (const line of boundaryLines(b)) {
      const d = pointToLineDistanceKm(point, line);
      if (d < bestKm) { bestKm = d; best = b; }
    }
  }
  return best;
}

function boundaryLines(b) {
  const geom = b?.geometry;
  if (!geom) return [];
  const t = b.geometryType || geom.type;
  if (t === 'LineString') return [geom.coordinates || []];
  if (t === 'MultiLineString') return geom.coordinates || [];
  if (t === 'Polygon') return geom.coordinates || [];
  if (t === 'MultiPolygon') return (geom.coordinates || []).flat();
  if (Array.isArray(geom.coordinates)) return [geom.coordinates];
  return [];
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all geometry tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/track-utils.js test/track-utils.test.js
git commit -m "feat: add track-utils geometry helpers"
```

---

## Task 4: `lib/async-pool.js` — concurrency-limited promise pool

**Files:**
- Create: `lib/async-pool.js`
- Test: `test/async-pool.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/async-pool.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asyncPool } from '../lib/async-pool.js';

test('asyncPool runs all items and returns results in order', async () => {
  const results = await asyncPool(2, [1, 2, 3, 4], async (n) => n * 10);
  assert.deepEqual(results, [10, 20, 30, 40]);
});

test('asyncPool respects concurrency limit', async () => {
  let active = 0;
  let maxActive = 0;
  await asyncPool(2, [1, 2, 3, 4, 5, 6], async () => {
    active++;
    if (active > maxActive) maxActive = active;
    await new Promise((r) => setTimeout(r, 10));
    active--;
  });
  assert.equal(maxActive, 2);
});

test('asyncPool with swallowErrors surfaces task errors as result items', async () => {
  const results = await asyncPool(2, [1, 2, 3], async (n) => {
    if (n === 2) throw new Error('boom');
    return n;
  }, { swallowErrors: true });
  assert.equal(results[0], 1);
  assert.ok(results[1] instanceof Error);
  assert.equal(results[2], 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `asyncPool` not defined.

- [ ] **Step 3: Implement `lib/async-pool.js`**

Create `lib/async-pool.js`:

```javascript
export async function asyncPool(limit, items, worker, { swallowErrors = false } = {}) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        if (swallowErrors) results[i] = err;
        else throw err;
      }
    }
  }

  const runners = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < n; i++) runners.push(runner());
  await Promise.all(runners);
  return results;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/async-pool.js test/async-pool.test.js
git commit -m "feat: add asyncPool concurrency helper"
```

---

## Task 5: `lib/track-store.js` — disk persistence

**Files:**
- Create: `lib/track-store.js`
- Test: `test/track-store.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/track-store.test.js`:

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureTrackStore,
  writeTrack,
  readTrack,
  hasTrack,
  upsertIndexEntry,
  readIndex,
  needsRefetch
} from '../lib/track-store.js';

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'track-store-'));
  configureTrackStore({ rootDir: dir });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('writeTrack persists JSON and readTrack returns it', async () => {
  const track = { type: 'FeatureCollection', features: [] };
  await writeTrack('p1', track);
  assert.deepEqual(await readTrack('p1'), track);
});

test('hasTrack returns false when missing, true when present', async () => {
  assert.equal(await hasTrack('missing'), false);
  await writeTrack('p2', { type: 'FeatureCollection', features: [] });
  assert.equal(await hasTrack('p2'), true);
});

test('upsertIndexEntry merges and persists per-patrol metadata', async () => {
  await upsertIndexEntry('p1', { fetched_at: 'T1', has_timestamps: true, point_count: 10 });
  await upsertIndexEntry('p2', { fetched_at: 'T2', has_timestamps: false, point_count: 0 });
  const idx = await readIndex();
  assert.equal(idx.p1.fetched_at, 'T1');
  assert.equal(idx.p2.has_timestamps, false);
});

test('needsRefetch: true when no entry exists', async () => {
  assert.equal(await needsRefetch({ id: 'p1', patrol_segments: [{ time_range: { end_time: null } }] }), true);
});

test('needsRefetch: false when patrol ended and entry has patrol_ended=true', async () => {
  await upsertIndexEntry('p1', { fetched_at: 'T1', has_timestamps: true, point_count: 5, patrol_ended: true });
  const patrol = { id: 'p1', patrol_segments: [{ time_range: { end_time: '2026-05-04T18:00:00Z' } }] };
  assert.equal(await needsRefetch(patrol), false);
});

test('needsRefetch: true when patrol still active even if entry exists', async () => {
  await upsertIndexEntry('p1', { fetched_at: 'T1', has_timestamps: true, point_count: 5, patrol_ended: false });
  const patrol = { id: 'p1', patrol_segments: [{ time_range: { end_time: null } }] };
  assert.equal(await needsRefetch(patrol), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/track-store.js`**

Create `lib/track-store.js`:

```javascript
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

let rootDir = join(process.cwd(), 'data', 'patrol-tracks');
let indexPath = join(process.cwd(), 'data', 'patrol-tracks-index.json');

export function configureTrackStore({ rootDir: r } = {}) {
  if (r) {
    rootDir = r;
    indexPath = join(r, '..', 'patrol-tracks-index.json');
  }
}

function trackPath(patrolId) {
  return join(rootDir, `${String(patrolId)}.json`);
}

async function atomicWrite(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, filePath);
}

export async function writeTrack(patrolId, track) {
  await atomicWrite(trackPath(patrolId), `${JSON.stringify(track)}\n`);
}

export async function readTrack(patrolId) {
  try {
    const raw = await readFile(trackPath(patrolId), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function hasTrack(patrolId) {
  try { await access(trackPath(patrolId)); return true; }
  catch { return false; }
}

export async function readIndex() {
  try {
    const raw = await readFile(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

export async function writeIndex(index) {
  await atomicWrite(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

export async function upsertIndexEntry(patrolId, entry) {
  const idx = await readIndex();
  idx[String(patrolId)] = { ...(idx[String(patrolId)] || {}), ...entry };
  await writeIndex(idx);
}

export async function needsRefetch(patrol) {
  const id = String(patrol.id);
  const ended = Boolean(patrol?.patrol_segments?.[0]?.time_range?.end_time);
  const idx = await readIndex();
  const entry = idx[id];
  if (!entry) return true;
  if (!ended) return true;
  if (!entry.patrol_ended) return true;
  return false;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 6 track-store tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/track-store.js test/track-store.test.js
git commit -m "feat: add track-store with atomic writes and refresh logic"
```

---

## Task 6: `lib/area-covered.js` — single-patrol aggregation

**Files:**
- Create: `lib/area-covered.js`
- Test: `test/area-covered.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/area-covered.test.js`:

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureTrackStore, writeTrack } from '../lib/track-store.js';
import { aggregateAreaCovered } from '../lib/area-covered.js';

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'area-covered-'));
  configureTrackStore({ rootDir: dir });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const boundaryNorth = {
  id: 'NORTH', name: 'North', geometryType: 'LineString',
  geometry: { type: 'LineString', coordinates: [[120.0, 13.5], [122.0, 13.5]] }
};
const boundarySouth = {
  id: 'SOUTH', name: 'South', geometryType: 'LineString',
  geometry: { type: 'LineString', coordinates: [[120.0, 12.5], [122.0, 12.5]] }
};

test('single patrol with timestamps uses real elapsed hours', async () => {
  const track = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[121.0, 13.5], [121.1, 13.5]] },
      properties: {
        coordinateProperties: { times: ['2026-05-04T10:00:00Z', '2026-05-04T10:05:00Z'] }
      }
    }]
  };
  await writeTrack('P1', track);
  const result = await aggregateAreaCovered({
    patrolIds: ['P1'],
    boundaries: [boundaryNorth, boundarySouth],
    patrolHoursById: {}
  });
  const north = result.aggregates.NORTH;
  assert.equal(north.coverage_patrols, 1);
  assert.ok(north.coverage_km > 10 && north.coverage_km < 12);
  assert.ok(Math.abs(north.coverage_hrs - 5 / 60) < 0.01, `got ${north.coverage_hrs}`);
  assert.equal(north.hrs_actual_count, 1);
  assert.equal(north.hrs_estimated_count, 0);
  assert.equal(result.missing_tracks.length, 0);
});

test('single patrol without timestamps falls back to distance-weighted hours', async () => {
  const track = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[121.0, 13.5], [121.1, 13.5], [121.2, 12.5]] }
    }]
  };
  await writeTrack('P2', track);
  const result = await aggregateAreaCovered({
    patrolIds: ['P2'],
    boundaries: [boundaryNorth, boundarySouth],
    patrolHoursById: { P2: 2 }
  });
  const totalHrs = (result.aggregates.NORTH?.coverage_hrs || 0)
    + (result.aggregates.SOUTH?.coverage_hrs || 0);
  assert.ok(Math.abs(totalHrs - 2) < 0.01, `expected ~2 total, got ${totalHrs}`);
  if (result.aggregates.NORTH) assert.equal(result.aggregates.NORTH.hrs_estimated_count, 1);
  if (result.aggregates.SOUTH) assert.equal(result.aggregates.SOUTH.hrs_estimated_count, 1);
});

test('zero-distance patrol does not divide by zero', async () => {
  const track = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[121.0, 13.5], [121.0, 13.5]] }
    }]
  };
  await writeTrack('P3', track);
  const result = await aggregateAreaCovered({
    patrolIds: ['P3'],
    boundaries: [boundaryNorth],
    patrolHoursById: { P3: 2 }
  });
  const north = result.aggregates.NORTH;
  if (north) {
    assert.ok(Number.isFinite(north.coverage_km));
    assert.ok(Number.isFinite(north.coverage_hrs));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `aggregateAreaCovered` not defined.

- [ ] **Step 3: Implement `lib/area-covered.js`**

Create `lib/area-covered.js`:

```javascript
import { readTrack } from './track-store.js';
import {
  extractCoordinatesWithTimes,
  haversineKm,
  midpoint,
  nearestBoundary
} from './track-utils.js';

export async function aggregateAreaCovered({ patrolIds, boundaries, patrolHoursById = {} }) {
  const aggregates = {};
  const missing_tracks = [];

  for (const pid of patrolIds) {
    const track = await readTrack(pid);
    if (!track) { missing_tracks.push(String(pid)); continue; }
    accumulatePatrol({
      track,
      boundaries,
      patrolTotalHrs: Number(patrolHoursById[pid]) || 0,
      aggregates
    });
  }

  return { aggregates, missing_tracks, generated_at: new Date().toISOString() };
}

function accumulatePatrol({ track, boundaries, patrolTotalHrs, aggregates }) {
  const { coordinates, times, hasTimestamps } = extractCoordinatesWithTimes(track);
  if (coordinates.length < 2) return;

  const perBoundaryKm = {};
  const perBoundaryHrs = {};
  let patrolTotalKm = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const segKm = haversineKm(a, b);
    if (segKm <= 0) continue;
    patrolTotalKm += segKm;

    const hit = nearestBoundary(midpoint(a, b), boundaries);
    if (!hit) continue;

    perBoundaryKm[hit.id] = (perBoundaryKm[hit.id] || 0) + segKm;

    if (hasTimestamps) {
      const dtMs = times[i] - times[i - 1];
      const hrs = Number.isFinite(dtMs) && dtMs > 0 ? dtMs / 3.6e6 : 0;
      perBoundaryHrs[hit.id] = (perBoundaryHrs[hit.id] || 0) + hrs;
    }
  }

  if (!hasTimestamps && patrolTotalKm > 0) {
    for (const [bid, km] of Object.entries(perBoundaryKm)) {
      perBoundaryHrs[bid] = patrolTotalHrs * (km / patrolTotalKm);
    }
  }

  for (const [bid, km] of Object.entries(perBoundaryKm)) {
    const boundary = boundaries.find((b) => String(b.id) === String(bid));
    if (!aggregates[bid]) {
      aggregates[bid] = {
        boundary_name: boundary?.name || bid,
        coverage_patrols: 0,
        coverage_km: 0,
        coverage_hrs: 0,
        hrs_estimated_count: 0,
        hrs_actual_count: 0
      };
    }
    aggregates[bid].coverage_patrols += 1;
    aggregates[bid].coverage_km += km;
    aggregates[bid].coverage_hrs += perBoundaryHrs[bid] || 0;
    if (hasTimestamps) aggregates[bid].hrs_actual_count += 1;
    else aggregates[bid].hrs_estimated_count += 1;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 3 area-covered tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/area-covered.js test/area-covered.test.js
git commit -m "feat: aggregateAreaCovered per-patrol logic"
```

---

## Task 7: `lib/area-covered.js` — multi-patrol + missing-tracks

**Files:**
- Modify: `test/area-covered.test.js`

- [ ] **Step 1: Append failing tests**

Append to `test/area-covered.test.js`:

```javascript
test('missing track is reported in missing_tracks', async () => {
  const result = await aggregateAreaCovered({
    patrolIds: ['DOES_NOT_EXIST'],
    boundaries: [boundaryNorth],
    patrolHoursById: {}
  });
  assert.deepEqual(result.missing_tracks, ['DOES_NOT_EXIST']);
  assert.equal(Object.keys(result.aggregates).length, 0);
});

test('multiple patrols accumulate into the same boundary buckets', async () => {
  const trackOne = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[121.0, 13.5], [121.1, 13.5]] },
      properties: { coordinateProperties: { times: ['2026-05-04T10:00:00Z', '2026-05-04T10:10:00Z'] } }
    }]
  };
  const trackTwo = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[121.2, 13.5], [121.3, 13.5]] },
      properties: { coordinateProperties: { times: ['2026-05-04T11:00:00Z', '2026-05-04T11:20:00Z'] } }
    }]
  };
  await writeTrack('P1', trackOne);
  await writeTrack('P2', trackTwo);
  const result = await aggregateAreaCovered({
    patrolIds: ['P1', 'P2'],
    boundaries: [boundaryNorth, boundarySouth],
    patrolHoursById: {}
  });
  const north = result.aggregates.NORTH;
  assert.equal(north.coverage_patrols, 2);
  assert.ok(Math.abs(north.coverage_hrs - 30 / 60) < 0.01, `got ${north.coverage_hrs}`);
});
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: the new tests pass with the Task 6 implementation. If any fail, fix `lib/area-covered.js` so they do.

- [ ] **Step 3: Commit**

```bash
git add test/area-covered.test.js
git commit -m "test: area-covered multi-patrol and missing-track cases"
```

---

## Task 8: Refactor `api/patrol-kilometers.js` to use shared `track-utils`

**Files:**
- Modify: `api/patrol-kilometers.js`

- [ ] **Step 1: Read current file**

Run: `cat api/patrol-kilometers.js`. Identify the local `extractCoordinates`, `computeTrackDistance`, and `haversineKm` functions.

- [ ] **Step 2: Replace with imports**

At the top, add (alongside existing imports):

```javascript
import { extractCoordinates, haversineKm } from '../lib/track-utils.js';
```

Delete the in-file `extractCoordinates`, `haversineKm`, and any helpers they used. Keep this small wrapper:

```javascript
function computeTrackDistance(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) total += haversineKm(coordinates[i - 1], coordinates[i]);
  return total;
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check api/patrol-kilometers.js`
Expected: exit 0.

- [ ] **Step 4: Smoke**

If Docker is running (replace `<ID>`):

```bash
curl -fsS "http://localhost:41739/api/patrol-kilometers?id=<ID>" | head -c 200
```

Expected: JSON with `kilometers` value, no error.

- [ ] **Step 5: Commit**

```bash
git add api/patrol-kilometers.js
git commit -m "refactor: patrol-kilometers uses shared track-utils"
```

---

## Task 9: `api/area-covered.js` — endpoint handler

**Files:**
- Create: `api/area-covered.js`

- [ ] **Step 1: Implement the endpoint**

Create `api/area-covered.js`:

```javascript
import { aggregateAreaCovered } from '../lib/area-covered.js';
import { getCachedPatrols } from '../lib/patrol-cache.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const boundaries = Array.isArray(body.boundaries) ? body.boundaries : [];
    if (boundaries.length === 0) {
      return res.status(400).json({ error: 'boundaries required' });
    }

    let patrolIds = Array.isArray(body.patrolIds) ? body.patrolIds.map(String) : null;
    const patrolHoursById = {};
    const cached = await getCachedPatrols();

    if (!patrolIds) {
      patrolIds = filterPatrolsByRange(cached, body.from, body.to).map((p) => String(p.id));
    }

    for (const p of cached) {
      const seg = p?.patrol_segments?.[0];
      const start = seg?.time_range?.start_time;
      const end = seg?.time_range?.end_time;
      if (start && end) {
        const hrs = (Date.parse(end) - Date.parse(start)) / 3.6e6;
        if (Number.isFinite(hrs) && hrs > 0) patrolHoursById[String(p.id)] = hrs;
      }
    }

    const result = await aggregateAreaCovered({ patrolIds, boundaries, patrolHoursById });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function filterPatrolsByRange(patrols, fromIso, toIso) {
  if (!fromIso || !toIso) return patrols;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return patrols.filter((p) => {
    const start = Date.parse(p?.patrol_segments?.[0]?.time_range?.start_time);
    if (!Number.isFinite(start)) return false;
    return start >= from && start <= to;
  });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check api/area-covered.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add api/area-covered.js
git commit -m "feat: add /api/area-covered endpoint"
```

---

## Task 10: Register route in `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add import**

Near the other route handler imports (around lines 10–11), add:

```javascript
import areaCoveredHandler from './api/area-covered.js';
```

- [ ] **Step 2: Add route entry**

In the routes array (currently lines 25–26 hold `patrol-kilometers` and `patrol-tracks`), add:

```javascript
{ pattern: /^\/api\/area-covered\/?$/, handler: areaCoveredHandler },
```

- [ ] **Step 3: Syntax check**

Run: `node --check server.js`
Expected: exit 0.

- [ ] **Step 4: Rebuild and smoke**

```bash
docker compose up -d --build
curl -fsS -X POST http://localhost:41739/api/area-covered \
  -H 'Content-Type: application/json' \
  -d '{"boundaries":[{"id":"X","name":"X","geometryType":"LineString","geometry":{"type":"LineString","coordinates":[[121,13],[122,13]]}}],"patrolIds":[]}'
```

Expected: `{"aggregates":{},"missing_tracks":[],"generated_at":"..."}`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: wire /api/area-covered route"
```

---

## Task 11: Sync engine fetches and persists tracks

**Files:**
- Modify: `lib/patrol-sync.js`

- [ ] **Step 1: Identify the post-upsert seam**

Run: `grep -n "upsertPatrols\|deepSync\|activeCheck\|export async function" lib/patrol-sync.js`

Note where `upsertPatrols(...)` is called inside the deep-sync function and the active-check function. The new helper will be invoked right after each `upsertPatrols` call with the same patrol list.

- [ ] **Step 2: Add imports**

Near the top of `lib/patrol-sync.js`:

```javascript
import { getSubjectTracks } from './earthranger.js';
import {
  hasTrack,
  needsRefetch,
  writeTrack,
  upsertIndexEntry
} from './track-store.js';
import { asyncPool } from './async-pool.js';
import { extractCoordinatesWithTimes } from './track-utils.js';
```

- [ ] **Step 3: Append the track sync helper**

At the bottom of `lib/patrol-sync.js`:

```javascript
const TRACK_FETCH_CONCURRENCY = 4;

export async function syncTracksForPatrols(patrols) {
  if (!Array.isArray(patrols) || patrols.length === 0) return { fetched: 0, skipped: 0, failed: 0 };

  const candidates = [];
  for (const p of patrols) {
    const seg = p?.patrol_segments?.[0];
    if (!seg?.leader?.id) continue;
    if (!seg?.time_range?.start_time) continue;
    if ((await hasTrack(p.id)) && !(await needsRefetch(p))) continue;
    candidates.push(p);
  }

  let fetched = 0;
  let failed = 0;
  await asyncPool(TRACK_FETCH_CONCURRENCY, candidates, async (patrol) => {
    const seg = patrol.patrol_segments[0];
    const subjectId = seg.leader.id;
    const since = seg.time_range.start_time;
    const until = seg.time_range.end_time || new Date().toISOString();
    try {
      const response = await getSubjectTracks(subjectId, since, until);
      const track = response?.data || response || null;
      if (!track) { failed += 1; return; }
      await writeTrack(patrol.id, track);
      const { coordinates, hasTimestamps } = extractCoordinatesWithTimes(track);
      await upsertIndexEntry(patrol.id, {
        fetched_at: new Date().toISOString(),
        has_timestamps: hasTimestamps,
        point_count: coordinates.length,
        last_track_time: coordinates.length ? until : null,
        patrol_ended: Boolean(seg.time_range.end_time),
        subject_id: subjectId,
        since,
        until
      });
      fetched += 1;
    } catch (err) {
      failed += 1;
    }
  }, { swallowErrors: true });

  return { fetched, skipped: patrols.length - candidates.length, failed };
}
```

- [ ] **Step 4: Call the helper after each `upsertPatrols`**

In the deep-sync function:

```javascript
const patrols = /* existing fetch */;
await upsertPatrols(patrols, 'deep-sync');
await syncTracksForPatrols(patrols);
```

In the active-check function:

```javascript
const patrols = /* existing fetch */;
await upsertPatrols(patrols, 'active-check');
await syncTracksForPatrols(patrols);
```

- [ ] **Step 5: Syntax check**

Run: `node --check lib/patrol-sync.js`
Expected: exit 0.

- [ ] **Step 6: Rebuild and confirm population**

```bash
docker compose up -d --build
docker compose logs -f app | head -n 50
```

After a sync cycle:

```bash
ls -la data/patrol-tracks | head -n 20
cat data/patrol-tracks-index.json | head -n 40
```

Expected: per-patrol `.json` files; index entries include `has_timestamps`/`point_count`.

- [ ] **Step 7: Commit**

```bash
git add lib/patrol-sync.js
git commit -m "feat: patrol sync persists GPS tracks per patrol"
```

---

## Task 12: `api/patrol-tracks.js` — disk-first read

**Files:**
- Modify: `api/patrol-tracks.js`

- [ ] **Step 1: Add import**

Add near top:

```javascript
import { readTrack } from '../lib/track-store.js';
```

- [ ] **Step 2: Insert disk-first lookup before the live fetch**

Inside the handler, right before the existing `const response = await getSubjectTracks(...)` line, insert:

```javascript
const diskTrack = await readTrack(stringId);
if (diskTrack) {
  const payload = {
    patrol_id: stringId,
    subject_id: segment.leader.id,
    subject_name: segment.leader.name || null,
    since,
    until,
    tracks: diskTrack,
    source: 'cache'
  };
  trackCache.set(stringId, { ts: Date.now(), payload });
  return res.status(200).json(payload);
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check api/patrol-tracks.js`
Expected: exit 0.

- [ ] **Step 4: Smoke**

```bash
docker compose up -d --build
curl -fsS "http://localhost:41739/api/patrol-tracks?id=<KNOWN_PATROL_ID>" | head -c 200
```

Expected: response JSON includes `"source":"cache"` once the sync has populated tracks for that patrol.

- [ ] **Step 5: Commit**

```bash
git add api/patrol-tracks.js
git commit -m "feat: patrol-tracks endpoint reads disk cache first"
```

---

## Task 13: Generated report — fetch Area Covered aggregates

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Locate the relevant spots**

Run:

```bash
grep -n "buildTemplateReportHtml\|getMunicipalityReportData\|municipalityJson\|customBoundaryJson\|escapeScriptJson" public/index.html
```

Identify (a) `buildTemplateReportHtml` body, (b) where `municipalityReportData` is computed, (c) where `municipalityJson` is embedded in the generated HTML template string.

- [ ] **Step 2: Add the frontend helper**

Near the other frontend helpers (above `buildTemplateReportHtml`), add:

```javascript
async function fetchAreaCoveredAggregates({ from, to, patrolIds, boundaries }) {
  try {
    const res = await fetch('/api/area-covered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, patrolIds, boundaries })
    });
    if (!res.ok) return { aggregates: {}, missing_tracks: [], error: 'HTTP ' + res.status };
    return await res.json();
  } catch (err) {
    return { aggregates: {}, missing_tracks: [], error: err.message };
  }
}
```

- [ ] **Step 3: Wire the call into `buildTemplateReportHtml`**

After `municipalityReportData` is computed, before the generated HTML template string is built:

```javascript
const areaCoveredPayload = await fetchAreaCoveredAggregates({
  from: report.from,
  to: report.to,
  patrolIds: report.patrolIds,
  boundaries: municipalityReportData.features
});
const areaCoveredJson = escapeScriptJson(areaCoveredPayload);
```

Use whichever variable name the existing code uses for the patrol id list passed to other report parts. Grep for `patrolIds` or `report.patrols` to find the right field.

- [ ] **Step 4: Inject the payload into the generated HTML template**

Where `municipalityJson` is interpolated into the generated `<script>` block, add a sibling line:

```html
<script>
  const municipalityReport = ${municipalityJson};
  const areaCovered = ${areaCoveredJson};
  // ...
</script>
```

- [ ] **Step 5: Verify scripts parse**

```bash
node --check server.js
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

Expected: `inline script parsed`.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: report template fetches area-covered aggregates"
```

---

## Task 14: Generated report — render Page 3

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Find the existing chart helper**

Run:

```bash
grep -n "renderBarChart\|drawBar\|mountBarChart\|chart" public/index.html | head -n 30
```

Identify the chart helper used by Page 2's raw metrics chart and its real signature. The Page 3 chart call in Step 3 should match that helper (rename the call site if needed).

- [ ] **Step 2: Add Page 3 markup inside the generated report HTML template**

After the Page 2 markup block, add:

```html
<section class="report-page" id="page-area-covered">
  <header class="report-page-header">
    <h2>Area Covered</h2>
  </header>
  <table id="area-covered-table">
    <thead>
      <tr>
        <th>Boundary</th>
        <th>Cov. Patrols</th>
        <th>KMS</th>
        <th>HRS</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
  <div id="area-covered-chart" class="report-chart"></div>
  <p id="area-covered-est-note" class="report-note" hidden>
    HRS values marked "Est." are distance-weighted estimates because per-point timestamps
    were not available from EarthRanger for one or more contributing patrols.
  </p>
  <p id="area-covered-missing-note" class="report-note" hidden></p>
</section>
```

- [ ] **Step 3: Add the renderer inside the generated report's inline `<script>` block**

Append after Page 2's render call:

```javascript
function renderAreaCoveredPage(payload) {
  const tbody = document.querySelector('#area-covered-table tbody');
  const estNote = document.getElementById('area-covered-est-note');
  const missingNote = document.getElementById('area-covered-missing-note');
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  const rows = Object.entries(payload && payload.aggregates ? payload.aggregates : {})
    .map(([id, v]) => Object.assign({ id }, v))
    .filter((r) => r.coverage_patrols > 0)
    .sort((a, b) => b.coverage_km - a.coverage_km);

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'No coverage in monitored boundaries for this period.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    let anyEstimated = false;
    for (const r of rows) {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.textContent = r.boundary_name;
      tr.appendChild(tdName);

      const tdPatrols = document.createElement('td');
      tdPatrols.textContent = String(r.coverage_patrols);
      tr.appendChild(tdPatrols);

      const tdKm = document.createElement('td');
      tdKm.textContent = r.coverage_km.toFixed(1);
      tr.appendChild(tdKm);

      const tdHrs = document.createElement('td');
      tdHrs.textContent = r.coverage_hrs.toFixed(1);
      if (r.hrs_estimated_count > 0) {
        const badge = document.createElement('span');
        badge.className = 'est-badge';
        badge.title = 'Distance-weighted estimate';
        badge.textContent = ' Est.';
        tdHrs.appendChild(badge);
        anyEstimated = true;
      }
      tr.appendChild(tdHrs);

      tbody.appendChild(tr);
    }
    if (anyEstimated) estNote.hidden = false;
  }

  if (payload && Array.isArray(payload.missing_tracks) && payload.missing_tracks.length > 0) {
    missingNote.hidden = false;
    missingNote.textContent = 'Patrols with missing GPS tracks: '
      + payload.missing_tracks.length + ' (excluded from totals).';
  }

  renderAreaCoveredChart(rows);
}

function renderAreaCoveredChart(rows) {
  // Match the existing Page 2 chart helper's real signature. Adapt this call after
  // identifying the helper in Step 1.
  renderBarChart({
    mountSelector: '#area-covered-chart',
    labels: rows.map((r) => r.boundary_name),
    values: rows.map((r) => Number(r.coverage_km.toFixed(1))),
    valueLabel: 'KMS'
  });
}

renderAreaCoveredPage(areaCovered);
```

If the existing chart helper has a different signature (e.g. takes a canvas element and a config object), adapt the `renderAreaCoveredChart` call accordingly. Do not add a new chart library.

- [ ] **Step 4: Verify inline script parses**

```bash
node --check server.js
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

Expected: `inline script parsed`.

- [ ] **Step 5: Rebuild and visually verify**

```bash
docker compose up -d --build
```

Open `http://localhost:41739/`, generate the template report for **May 4, 2026 – May 10, 2026**, and confirm:

1. Page 3 "Area Covered" appears after Page 2.
2. The table shows only boundaries that received at least one segment.
3. Rows sorted by KMS descending.
4. Coverage KMS bar chart renders.
5. "Est." badge appears next to HRS only when at least one contributing patrol lacked timestamps.
6. If any patrols have no track on disk, the missing-tracks footer line is visible.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: render Area Covered page 3 in generated report"
```

---

## Task 15: Final reconciliation smoke

**Files:**
- None modified (unless adjustments needed)

- [ ] **Step 1: Reconcile totals**

For May 4–10, 2026, the sum of `coverage_km` across all Page 3 rows should be approximately equal to the total patrol-level KMS for the same period (already computed by existing kilometers logic). Differences within rounding are expected; larger gaps mean `extractCoordinatesWithTimes` and the existing extraction produce different orderings for a patrol with multiple features.

- [ ] **Step 2: Estimated vs actual HRS labeling**

Find one patrol whose track file includes `feature.properties.coordinateProperties.times` and one that does not. Generate the report and confirm only the second triggers the "Est." indicator on the boundary that received its segments.

- [ ] **Step 3: Confirm unchanged surfaces**

Manage List, Patrol Sync indicators, Boundaries modal, Page 1, and Page 2 should behave exactly as before.

- [ ] **Step 4: Commit any final adjustments (or skip)**

If you made tweaks during steps 1–3, commit them with a descriptive message. Otherwise this task is documentation only.

---

## Done When

- `npm test` passes all suites.
- The generated template report for any selected date range shows Page 3 with non-empty, sensible aggregates when data exists.
- Sum of Page 3 coverage KMS reconciles with patrol-level total KMS for the same period (modulo rounding).
- Patrols with no track files are reported in the missing-tracks footer rather than silently dropped.
- "Est." badge appears if and only if at least one contributing patrol used the distance-weighted fallback for that boundary.
- Server logs show track persistence happens after each deep-sync and active-check cycle.
- Page 1 and Page 2 of the generated report are unchanged.
