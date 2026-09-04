import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSample, deltaSince, RETENTION_SEC } from '../src/lib/history.js';

const M = 60_000;
const s = (t, missed) => ({ t, missed });

test('addSample appends and keeps samples ordered by time', () => {
  const out = addSample(addSample([], s(2000, { a: 1 })), s(1000, { a: 0 }));
  assert.deepEqual(out.map((x) => x.t), [1000, 2000]);
});

test('addSample keeps every sample from the last 10 minutes', () => {
  let out = [];
  for (let i = 0; i < 30; i++) out = addSample(out, s(100 * M - 9 * M + i * 10_000, { a: i }));
  assert.equal(out.length, 30);
});

test('addSample thins samples older than 10 minutes to one per minute', () => {
  let out = [];
  for (let i = 0; i < 60; i++) out = addSample(out, s(i * 10_000, { a: i }));
  out = addSample(out, s(30 * M, { a: 99 }));
  assert.deepEqual(out.map((x) => x.t), [0, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 480_000, 540_000, 30 * M]);
});

test('addSample drops samples older than the retention window', () => {
  let out = addSample([], s(0, { a: 0 }));
  out = addSample(out, s(RETENTION_SEC * 1000 + 1000, { a: 1 }));
  assert.deepEqual(out.map((x) => x.t), [RETENTION_SEC * 1000 + 1000]);
});

test('deltaSince uses the newest sample at least windowSec old', () => {
  const samples = [s(0, { a: 0 }), s(30 * M, { a: 2 }), s(59 * M, { a: 3 }), s(61 * M, { a: 4 })];
  assert.deepEqual(deltaSince(samples, 'a', 10, 3600, 120 * M), { delta: 7, partial: false, sinceT: 59 * M });
});

test('deltaSince falls back to the oldest sample and marks partial', () => {
  const samples = [s(100 * M, { a: 1 }), s(110 * M, { a: 2 })];
  assert.deepEqual(deltaSince(samples, 'a', 5, 3600, 120 * M), { delta: 4, partial: true, sinceT: 100 * M });
});

test('deltaSince returns null without samples or without the owner', () => {
  assert.equal(deltaSince([], 'a', 5, 3600, 0), null);
  assert.equal(deltaSince([s(0, { b: 1 })], 'a', 5, 3600, 3600_000), null);
});
