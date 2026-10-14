// Exercise the browser refresh controller with a minimal DOM and controlled network timing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, DEFAULT_NODE } from '../src/lib/chain.js';
import { derive } from '../src/lib/derive.js';
import { evaluate } from '../src/lib/health.js';
import { addSample } from '../src/lib/history.js';
import { COLUMNS } from '../src/lib/columns.js';
import { fmtTime } from '../src/lib/format.js';
import * as R from '../src/ui/render.js';
import { loadBlockCache, saveBlockCache } from '../src/lib/block-cache.js';
import { raw, witness } from './fixtures.js';

const source = (await readFile(new URL('../src/ui/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace(/\ninit\(\);\s*$/, '\nreturn { state, refresh, setNode };');

function controller(configPromise, overrides = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      classList: { add() {}, remove() {} },
      querySelector: (selector) => element(id + selector),
    });
    return elements.get(id);
  };
  const ctx = {
    DEFAULT_CONFIG, DEFAULT_NODE, loadBlockCache, saveBlockCache, derive, evaluate, addSample, COLUMNS, fmtTime, R,
    window: { localStorage: { getItem: () => null, setItem() {} } },
    location: { search: '' }, document: { getElementById: element, hidden: false },
    clearTimeout() {}, setTimeout() {},
    readSettings: () => ({ node: DEFAULT_NODE, interval: 0, window: 300, sort: 'rank', dir: 'asc' }),
    fetchConfig: () => configPromise,
    fetchSnapshot: async (node, opts) => {
      const snapshot = raw({ config: opts.config });
      opts.onUpdate?.(snapshot, 'core');
      return snapshot;
    },
  };
  Object.assign(ctx, overrides);
  return { ...new Function(...Object.keys(ctx), source)(...Object.values(ctx)), elements };
}

test('paused first load paints early and then uses verified config in the final model', async () => {
  let resolve;
  const configPromise = new Promise((r) => { resolve = r; });
  const app = controller(configPromise);
  const refreshing = app.refresh();
  await Promise.resolve();
  assert.match(app.elements.get('tiles').innerHTML, /Head block/);
  resolve({ ...DEFAULT_CONFIG, blockInterval: 6, maxWitnesses: 42 });
  await refreshing;
  assert.equal(app.state.settings.interval, 0);
  assert.equal(app.state.model.chain.blockInterval, 6);
  assert.equal(app.state.model.chain.maxWitnesses, 42);
});

test('config failure preserves the dashboard and reports the partial error', async () => {
  const app = controller(Promise.reject(new Error('config unavailable')));
  await app.refresh();
  assert.equal(app.state.model.chain.blockInterval, DEFAULT_CONFIG.blockInterval);
  assert.ok(app.state.model.errors.some((e) => e.includes('config unavailable')));
});


test('refresh paints new core and blocks before extras without committing partial history', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const previous = raw({ dgp: { head_block_number: 100 } });
  const latest = raw({ dgp: { head_block_number: 101 }, blocks: [{ num: 101, timestamp: '2026-09-04T12:05:03', witness: 'initminer', txCount: 2 }] });
  const app = controller(Promise.resolve(DEFAULT_CONFIG), { fetchSnapshot: async (node, opts) => {
    opts.onUpdate?.({ ...latest, blocks: [], extras: { accounts: null, votes: null } }, 'core');
    opts.onUpdate?.({ ...latest, extras: { accounts: null, votes: null } }, 'blocks');
    await gate;
    opts.onUpdate?.(latest, 'extras');
    return latest;
  } });
  app.state.model = derive(previous);
  const completed = app.state.model;
  const refreshing = app.refresh();
  await Promise.resolve();
  assert.match(app.elements.get('network').innerHTML, /#101/);
  assert.match(app.elements.get('blocks-meta').textContent, /#101/);
  assert.equal(app.state.model, completed);
  assert.equal(app.state.history.length, 0);
  release();
  await refreshing;
  assert.equal(app.state.model.network.headBlock, 101);
  assert.equal(app.state.history.length, 1);
});


test('first staged paint lists block producers by witness rank, not by block order', async () => {
  const snapshot = raw({ witnesses: [witness('rank-first', { votes: '2000' }), witness('block-first', { votes: '1000' })],
    blocks: [{ num: 1, witness: 'block-first', timestamp: '2026-09-04T12:00:03', txCount: 0 },
      { num: 2, witness: 'rank-first', timestamp: '2026-09-04T12:00:06', txCount: 0 }] });
  const app = controller(Promise.resolve(DEFAULT_CONFIG), { fetchSnapshot: async (node, opts) => {
    opts.onUpdate?.({ ...snapshot, blocks: [] }, 'core');
    opts.onUpdate?.(snapshot, 'blocks');
    return snapshot;
  } });
  await app.refresh();
  const lanes = [...app.elements.get('blocks').innerHTML.matchAll(/data-lane="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(lanes, ['rank-first', 'block-first']);
});

test('switching nodes clears old block and footer content before new blocks arrive', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const app = controller(Promise.resolve(DEFAULT_CONFIG), {
    settingsToQuery: () => new URLSearchParams(), writeSettings() {}, history: { replaceState() {} },
    fetchSnapshot: async (node, opts) => {
      const snapshot = raw();
      opts.onUpdate?.(snapshot, 'core');
      await gate;
      return snapshot;
    },
  });
  app.elements.set('blocks', { innerHTML: 'previous node blocks' });
  app.elements.set('footer-meta', { textContent: 'previous node refresh' });
  app.setNode('https://other.test');
  assert.equal(app.elements.get('blocks').innerHTML, '');
  assert.equal(app.elements.get('footer-meta').textContent, '');
  release();
  await gate;
});

test('switching nodes during a refresh does not flash the NO DATA banner', async () => {
  const gates = [];
  const app = controller(Promise.resolve(DEFAULT_CONFIG), {
    settingsToQuery: () => new URLSearchParams(), writeSettings() {}, history: { replaceState() {} },
    fetchSnapshot: (node, opts) => new Promise((resolve) => gates.push(() => { const s = raw(); opts.onUpdate?.(s, 'core'); resolve(s); })),
  });
  const first = app.refresh();
  app.setNode('https://other.test');
  gates[0]();
  await first;
  assert.doesNotMatch(app.elements.get('network').innerHTML ?? '', /NO DATA/, 'the discarded refresh must not paint');
  assert.equal(gates.length, 2, 'the queued refresh for the new node started');
  gates[1]();
  await new Promise((r) => setImmediate(r));
  assert.match(app.elements.get('network').innerHTML, /net-label/);
  assert.equal(app.state.model.node, 'https://node.test');
});

// fetchSnapshot that, like the real one, returns the config it was given (or the built-in
// constants with an error when it had to fetch them and that failed).
const snapshotWith = (seen) => async (node, opts) => {
  seen.push(opts.config);
  const s = { ...raw(), config: opts.config ?? DEFAULT_CONFIG, errors: opts.config ? [] : ['get_config: boom'] };
  opts.onUpdate?.(s, 'core');
  return s;
};
const never = () => new Promise(() => {});

test('after a failed get_config, later refreshes neither wait for it nor retry it within 10 minutes', { timeout: 2000 }, async () => {
  const calls = [];
  const replies = [Promise.reject(new Error('config unavailable')), never(), Promise.resolve({ ...DEFAULT_CONFIG, blockInterval: 6 })];
  const app = controller(null, { fetchConfig: () => { calls.push(1); return replies.shift(); }, fetchSnapshot: snapshotWith([]) });
  await app.refresh();
  assert.ok(app.state.model.errors.some((e) => e.includes('config unavailable')));
  await app.refresh();
  assert.equal(calls.length, 1, 'no retry within 10 minutes');
  assert.ok(app.state.model.errors.some((e) => e.includes('config unavailable')), 'the error stays visible while built-ins are used');
  app.state.configTry.at -= 11 * 60_000;
  await app.refresh();
  assert.equal(calls.length, 2, 'retried after 10 minutes, without waiting for it');
  app.state.configTry.at -= 11 * 60_000;
  await app.refresh();
  assert.equal(calls.length, 3);
  await new Promise((r) => setImmediate(r));
  assert.equal(app.state.config.blockInterval, 6, 'a late success is kept for the next refresh');
  await app.refresh();
  assert.equal(app.state.model.chain.blockInterval, 6);
  assert.ok(!app.state.model.errors.some((e) => e.includes('get_config')));
});

test('a custom node whose get_config fails waits once, then refreshes with built-in constants', { timeout: 2000 }, async () => {
  const seen = [];
  const app = controller(never(), {
    settingsToQuery: () => new URLSearchParams(), writeSettings() {}, history: { replaceState() {} },
    fetchSnapshot: snapshotWith(seen),
  });
  app.setNode('https://other.test');
  await new Promise((r) => setImmediate(r));
  await app.refresh();
  assert.deepEqual(seen, [null, DEFAULT_CONFIG]);
  assert.ok(app.state.model.errors.includes('get_config: boom'));
});
