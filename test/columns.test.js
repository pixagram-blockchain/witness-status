import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, sortRows, STATUS_ORDER } from '../src/lib/columns.js';

const row = (owner, o = {}) => ({
  rank: 1, owner, status: 'active', votesVests: 1, votesPixa: 1, voteShare: 0.1, voters: 1, totalMissed: 0, missedSinceLoad: 0,
  missed1h: { delta: 0 }, missed24h: null, producedInWindow: 1, lastConfirmedBlock: 10, feed: { price: 100, ageSec: 5, deviationPct: 0 },
  version: { running: '1.28.7' }, hfVote: { version: '1.28.0' }, props: { accountCreationFee: 0, maxBlockSize: 262144 },
  account: { vests: 5 }, signingKey: 'PIX7', ...o,
});
const names = (rows) => rows.map((r) => r.owner);

test('sortRows sorts numbers ascending and descending', () => {
  const rows = [row('a', { totalMissed: 5 }), row('b', { totalMissed: 1 }), row('c', { totalMissed: 3 })];
  assert.deepEqual(names(sortRows(rows, 'totalMissed', 'asc')), ['b', 'c', 'a']);
  assert.deepEqual(names(sortRows(rows, 'totalMissed', 'desc')), ['a', 'c', 'b']);
});

test('sortRows puts nulls last in both directions', () => {
  const rows = [row('a', { voters: null }), row('b', { voters: 2 }), row('c', { voters: 1 })];
  assert.deepEqual(names(sortRows(rows, 'voters', 'asc')), ['c', 'b', 'a']);
  assert.deepEqual(names(sortRows(rows, 'voters', 'desc')), ['b', 'c', 'a']);
});

test('sortRows reads nested getters such as missed1h.delta', () => {
  const rows = [row('a', { missed1h: { delta: 3 } }), row('b', { missed1h: null }), row('c', { missed1h: { delta: 1 } })];
  assert.deepEqual(names(sortRows(rows, 'missed1h', 'desc')), ['a', 'c', 'b']);
});

test('sortRows sorts strings alphabetically', () => {
  const rows = [row('bob'), row('alice'), row('carol')];
  assert.deepEqual(names(sortRows(rows, 'owner', 'asc')), ['alice', 'bob', 'carol']);
  assert.deepEqual(names(sortRows(rows, 'owner', 'desc')), ['carol', 'bob', 'alice']);
});

test('sortRows orders versions numerically', () => {
  const rows = [row('a', { version: { running: '1.28.10' } }), row('b', { version: { running: '1.28.7' } }), row('c', { version: { running: '0.0.0' } })];
  assert.deepEqual(names(sortRows(rows, 'version', 'asc')), ['c', 'b', 'a']);
});

test('sortRows orders status active, standby, disabled', () => {
  const rows = [row('a', { status: 'disabled' }), row('b', { status: 'active' }), row('c', { status: 'standby' })];
  assert.deepEqual(names(sortRows(rows, 'status', 'asc')), ['b', 'c', 'a']);
  assert.deepEqual(STATUS_ORDER, { active: 0, standby: 1, disabled: 2 });
});

test('sortRows breaks ties by owner ascending', () => {
  const rows = [row('b', { totalMissed: 1 }), row('a', { totalMissed: 1 }), row('c', { totalMissed: 0 })];
  assert.deepEqual(names(sortRows(rows, 'totalMissed', 'desc')), ['a', 'b', 'c']);
});

test('sortRows falls back to rank for an unknown key', () => {
  const rows = [row('a', { rank: 2 }), row('b', { rank: 1 })];
  assert.deepEqual(names(sortRows(rows, 'nope', 'asc')), ['b', 'a']);
});

test('sortRows does not mutate its input', () => {
  const rows = [row('b'), row('a')];
  sortRows(rows, 'owner');
  assert.deepEqual(names(rows), ['b', 'a']);
});

test('every column getter returns a number, string or null', () => {
  const full = row('a');
  const empty = row('b', { voters: null, missed1h: null, feed: { price: null, ageSec: null, deviationPct: null }, account: null, lastConfirmedBlock: null });
  for (const c of COLUMNS) {
    for (const r of [full, empty]) {
      const v = c.get(r);
      assert.ok(v === null || typeof v === 'number' || typeof v === 'string', `${c.key} returned ${typeof v}`);
    }
  }
});

test('columns have unique keys, labels, tooltips and types', () => {
  const keys = COLUMNS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of COLUMNS) {
    assert.ok(c.label, c.key);
    assert.ok(c.title.length > 10, c.key);
    assert.ok(['num', 'str', 'version'].includes(c.type), c.key);
    assert.equal(typeof c.defaultVisible, 'boolean', c.key);
  }
  for (const k of ['rank', 'owner', 'status', 'votesVests', 'totalMissed', 'missed1h', 'feedPrice', 'version', 'signingKey']) assert.ok(keys.includes(k), k);
});
