import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsset, parseUtc, isEpoch } from '../src/lib/assets.js';

test('parseAsset parses legacy string', () => {
  assert.deepEqual(parseAsset('245098.039 PXS'), { amount: 245098.039, symbol: 'PXS' });
});

test('parseAsset parses NAI object with 3 decimals', () => {
  assert.deepEqual(parseAsset({ amount: '100000000000', precision: 3, nai: '@@000000021' }), { amount: 100000000, symbol: 'PIXA' });
});

test('parseAsset parses VESTS NAI with 6 decimals', () => {
  assert.deepEqual(parseAsset({ amount: '1500000', precision: 6, nai: '@@000000037' }), { amount: 1.5, symbol: 'VESTS' });
});

test('parseAsset returns null for missing input', () => {
  assert.equal(parseAsset(null), null);
  assert.equal(parseAsset(undefined), null);
});

test('parseUtc treats zone-less timestamps as UTC', () => {
  assert.equal(parseUtc('2026-09-04T12:00:00'), Date.UTC(2026, 8, 4, 12, 0, 0));
});

test('parseUtc accepts trailing Z', () => {
  assert.equal(parseUtc('2026-09-04T12:00:00Z'), Date.UTC(2026, 8, 4, 12, 0, 0));
});

test('parseUtc returns NaN for empty input', () => {
  assert.ok(Number.isNaN(parseUtc('')));
});

test('isEpoch detects the 1970 sentinel', () => {
  assert.equal(isEpoch('1970-01-01T00:00:00'), true);
  assert.equal(isEpoch('2026-09-04T12:00:00'), false);
});
