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
