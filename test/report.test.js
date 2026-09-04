import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, textReport, snapshotDocument, USAGE } from '../src/lib/report.js';
import { derive } from '../src/lib/derive.js';
import { evaluate } from '../src/lib/health.js';
import * as fx from './fixtures.js';

const G = Date.parse(fx.GENESIS + 'Z');
const NOW = G + 3600_000;
const started = { head_block_number: 1200, current_aslot: 1205, last_irreversible_block_num: 1190, time: '2026-09-04T12:59:58', current_witness: 'a' };

test('parseArgs applies defaults', () => {
  assert.deepEqual(parseArgs([]), { node: 'https://api.pixagram.com', window: 300, previous: null, format: 'json', check: false, out: null, help: false, error: null });
});

test('parseArgs accepts --key value and --key=value forms', () => {
  const a = parseArgs(['--node=https://x', '--window', '100', '--previous', 'p.json', '--format', 'text', '--check', '--out', 'dir']);
  assert.deepEqual(a, { node: 'https://x', window: 100, previous: 'p.json', format: 'text', check: true, out: 'dir', help: false, error: null });
});

test('parseArgs reports unknown flags and bad values', () => {
  assert.match(parseArgs(['--bogus']).error, /bogus/);
  assert.match(parseArgs(['--window', 'abc']).error, /window/);
  assert.match(parseArgs(['--format', 'xml']).error, /format/);
  assert.match(parseArgs(['--node']).error, /node/);
});

test('parseArgs recognises help', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('textReport summarises network, chain, blocks, health and every witness', () => {
  const witnesses = [fx.witness('a', { total_missed: 3, last_confirmed_block_num: 1200, running_version: '1.28.7' }), fx.witness('b', { signing_key: fx.NULL_KEY })];
  const m = derive(fx.raw({ witnesses, dgp: started, schedule: { current_shuffled_witnesses: ['a', ...Array(20).fill('')], num_scheduled_witnesses: 1, majority_version: '1.28.7' } }), { now: NOW });
  const h = evaluate(m);
  const t = textReport(m, h, NOW);
  assert.match(t, /PROGRESSING/);
  assert.match(t, /head #1,200/);
  assert.match(t, /LIB #1,190 \(lag 10\)/);
  assert.match(t, /participation 100\.0%/);
  assert.match(t, /hived 1\.28\.7/);
  assert.match(t, /witnesses 2 \(1 active, 0 standby, 1 disabled\)/);
  assert.match(t, /HEALTH\s+WARN \(exit 1\)/);
  assert.match(t, /^\s*1\s+a\*\s+active\s+/m);
  assert.match(t, /^\s*2\s+b\s+disabled\s+/m);
  assert.match(t, /feed_missing/);
  assert.match(t, /few_witnesses/);
  assert.match(t, /2026-09-04 13:00:00 UTC/);
});

test('textReport describes a chain that has not started', () => {
  const m = derive(fx.raw(), { now: G - 600_000 });
  const t = textReport(m, evaluate(m), G - 600_000);
  assert.match(t, /NOT STARTED/);
  assert.match(t, /genesis in 10m 0s/);
});

test('snapshotDocument wraps model and health with schema and timestamp', () => {
  const m = derive(fx.raw(), { now: NOW });
  const h = evaluate(m);
  const d = snapshotDocument(m, h, NOW);
  assert.equal(d.schema, 1);
  assert.equal(d.generatedAt, new Date(NOW).toISOString());
  assert.equal(d.node, 'https://node.test');
  assert.equal(d.health, h);
  assert.equal(d.model, m);
});

test('USAGE mentions every flag', () => {
  for (const f of ['--node', '--window', '--previous', '--format', '--check', '--out', '--help']) assert.ok(USAGE.includes(f), f);
});
