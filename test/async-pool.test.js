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
