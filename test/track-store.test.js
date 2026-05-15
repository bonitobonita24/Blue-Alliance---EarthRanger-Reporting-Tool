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
