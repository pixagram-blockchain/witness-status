import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/lib/health.js';

const wit = (owner, o = {}) => ({
  owner, status: 'active', disabled: false, missedSincePrev: 0, shutdownRisk: false, blocksSinceConfirmed: 3,
  feed: { price: 100, stale: false }, version: { running: '1.28.7', behind: false }, props: { maxBlockSize: 262144, maxBlockSizeDiffers: false }, ...o,
});
const model = (o = {}) => ({
  network: { status: 'progressing', participationPct: 100, libLag: 5, headAgeSec: 2, genesisInSec: null, rate: null, ...(o.network ?? {}) },
  schedule: { n: 5, ...(o.schedule ?? {}) },
  witnesses: o.witnesses ?? [wit('a')],
});
const codes = (r) => [...r.network.map((f) => f.code), ...Object.values(r.witnesses).flat().map((f) => f.code)];

test('a healthy model is ok with exit code 0', () => {
  const r = evaluate(model());
  assert.equal(r.level, 'ok');
  assert.equal(r.exitCode, 0);
  assert.deepEqual(codes(r), []);
});

test('not_started is info and exits 0', () => {
  const r = evaluate(model({ network: { status: 'not_started', genesisInSec: 100 } }));
  assert.equal(r.level, 'info');
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.network.map((f) => f.code), ['not_started']);
});

test('lagging is warn and exits 1', () => {
  const r = evaluate(model({ network: { status: 'lagging', headAgeSec: 12 } }));
  assert.equal(r.level, 'warn');
  assert.equal(r.exitCode, 1);
  assert.deepEqual(codes(r), ['lagging']);
});

test('stalled is critical and exits 2', () => {
  const r = evaluate(model({ network: { status: 'stalled', headAgeSec: 120 } }));
  assert.equal(r.level, 'critical');
  assert.equal(r.exitCode, 2);
  assert.deepEqual(codes(r), ['stalled']);
});

test('participation below 90 % warns and below 66 % is critical', () => {
  assert.deepEqual(evaluate(model({ network: { participationPct: 85 } })).network.map((f) => [f.level, f.code]), [['warn', 'participation']]);
  assert.deepEqual(evaluate(model({ network: { participationPct: 50 } })).network.map((f) => [f.level, f.code]), [['critical', 'participation']]);
  assert.deepEqual(evaluate(model({ network: { participationPct: 90 } })).network, []);
});

test('LIB lag above 30 warns', () => {
  assert.deepEqual(evaluate(model({ network: { libLag: 31 } })).network.map((f) => [f.level, f.code]), [['warn', 'lib_lag']]);
  assert.deepEqual(evaluate(model({ network: { libLag: 30 } })).network, []);
});

test('fewer than 3 scheduled witnesses is info', () => {
  const r = evaluate(model({ schedule: { n: 2 } }));
  assert.deepEqual(r.network.map((f) => [f.level, f.code]), [['info', 'few_witnesses']]);
  assert.equal(r.exitCode, 0);
});

test('a disabled witness gets only the disabled info flag', () => {
  const r = evaluate(model({ witnesses: [wit('a', { status: 'disabled', disabled: true, feed: { price: null, stale: true }, version: { running: '0.0.0', behind: true } })] }));
  assert.deepEqual(r.witnesses.a.map((f) => [f.level, f.code]), [['info', 'disabled']]);
});

test('a recent missed block warns', () => {
  const r = evaluate(model({ witnesses: [wit('a', { missedSincePrev: 1 })] }));
  assert.deepEqual(r.witnesses.a.map((f) => [f.level, f.code]), [['warn', 'missed_recent']]);
});

test('shutdown risk is critical', () => {
  const r = evaluate(model({ witnesses: [wit('a', { shutdownRisk: true, blocksSinceConfirmed: 30000 })] }));
  assert.deepEqual(r.witnesses.a.map((f) => [f.level, f.code]), [['critical', 'shutdown_risk']]);
  assert.equal(r.exitCode, 2);
});

test('an active witness not producing for two rounds warns', () => {
  assert.deepEqual(evaluate(model({ witnesses: [wit('a', { blocksSinceConfirmed: 32 })] })).witnesses.a.map((f) => f.code), ['not_producing']);
  assert.deepEqual(evaluate(model({ witnesses: [wit('a', { blocksSinceConfirmed: 31 })] })).witnesses.a, []);
  assert.deepEqual(evaluate(model({ witnesses: [wit('a', { blocksSinceConfirmed: null })] })).witnesses.a, []);
});

test('a standby witness not producing is not flagged', () => {
  assert.deepEqual(evaluate(model({ witnesses: [wit('a', { status: 'standby', blocksSinceConfirmed: 5000 })] })).witnesses.a, []);
});

test('a missing or stale feed warns', () => {
  assert.deepEqual(evaluate(model({ witnesses: [wit('a', { feed: { price: null, stale: true } })] })).witnesses.a.map((f) => [f.level, f.code]), [['warn', 'feed_missing']]);
  assert.deepEqual(evaluate(model({ witnesses: [wit('a', { feed: { price: 100, stale: true } })] })).witnesses.a.map((f) => [f.level, f.code]), [['warn', 'feed_stale']]);
});

test('a version behind the majority warns', () => {
  assert.deepEqual(evaluate(model({ witnesses: [wit('a', { version: { running: '1.28.6', behind: true } })] })).witnesses.a.map((f) => [f.level, f.code]), [['warn', 'version_behind']]);
});

test('a differing max block size is info', () => {
  const r = evaluate(model({ witnesses: [wit('a', { props: { maxBlockSize: 65536, maxBlockSizeDiffers: true } })] }));
  assert.deepEqual(r.witnesses.a.map((f) => [f.level, f.code]), [['info', 'block_size_differs']]);
  assert.equal(r.exitCode, 0);
});

test('the overall level is the maximum over all flags', () => {
  const r = evaluate(model({ schedule: { n: 2 }, network: { libLag: 40 }, witnesses: [wit('a', { shutdownRisk: true })] }));
  assert.equal(r.level, 'critical');
  assert.equal(r.exitCode, 2);
});

test('witness rules other than disabled are skipped before genesis', () => {
  const r = evaluate(model({ network: { status: 'not_started' }, witnesses: [wit('a', { feed: { price: null, stale: true } }), wit('b', { status: 'disabled', disabled: true })] }));
  assert.deepEqual(codes(r), ['not_started', 'disabled']);
});

test('flags carry human-readable messages', () => {
  const r = evaluate(model({ network: { status: 'lagging', headAgeSec: 12 }, witnesses: [wit('a', { missedSincePrev: 2 })] }));
  for (const f of [...r.network, ...r.witnesses.a]) {
    assert.ok(['ok', 'info', 'warn', 'critical'].includes(f.level));
    assert.equal(typeof f.code, 'string');
    assert.ok(f.message.length > 5);
  }
  assert.match(r.witnesses.a[0].message, /2 block/);
});
