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
