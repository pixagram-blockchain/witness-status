import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtInt, fmtNum, fmtCompact, fmtPct, fmtDuration, fmtAge, fmtBytes, shortKey, fmtTime } from '../src/lib/format.js';

test('fmtInt groups thousands and shows a dash for null', () => {
  assert.equal(fmtInt(1234567), '1,234,567');
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtInt(null), '–');
  assert.equal(fmtInt(NaN), '–');
});

test('fmtNum keeps the requested decimals', () => {
  assert.equal(fmtNum(1234.5678, 2), '1,234.57');
  assert.equal(fmtNum(2), '2.000');
  assert.equal(fmtNum(null), '–');
});

test('fmtCompact abbreviates large numbers', () => {
  assert.equal(fmtCompact(1234567), '1.23M');
  assert.equal(fmtCompact(12500), '12.5K');
  assert.equal(fmtCompact(950), '950');
  assert.equal(fmtCompact(2.5e9), '2.50B');
  assert.equal(fmtCompact(null), '–');
});

test('fmtPct formats percentages', () => {
  assert.equal(fmtPct(12.345), '12.3%');
  assert.equal(fmtPct(0.5, 2), '0.50%');
  assert.equal(fmtPct(null), '–');
});

test('fmtDuration picks the two largest units', () => {
  assert.equal(fmtDuration(0), '0s');
  assert.equal(fmtDuration(12), '12s');
  assert.equal(fmtDuration(184), '3m 4s');
  assert.equal(fmtDuration(7500), '2h 5m');
  assert.equal(fmtDuration(266400), '3d 2h');
  assert.equal(fmtDuration(null), '–');
});

test('fmtAge describes past and future', () => {
  assert.equal(fmtAge(12), '12s ago');
  assert.equal(fmtAge(-10800), 'in 3h 0m');
  assert.equal(fmtAge(null), '–');
});

test('fmtBytes uses binary units', () => {
  assert.equal(fmtBytes(262144), '256 KiB');
  assert.equal(fmtBytes(2097152), '2 MiB');
  assert.equal(fmtBytes(500), '500 B');
  assert.equal(fmtBytes(1536), '1.5 KiB');
});

test('shortKey keeps the prefix and the tail', () => {
  assert.equal(shortKey('PIX7J9nSaLkdSgcXufXmdn8Gm686rhbt9P8nJDzpePykUHSqZmw7Y'), 'PIX7J9nS…mw7Y');
  assert.equal(shortKey(''), '');
});

test('fmtTime prints UTC', () => {
  assert.equal(fmtTime(Date.UTC(2026, 8, 4, 12, 0, 0)), '2026-09-04 12:00:00 UTC');
  assert.equal(fmtTime(null), '–');
});
