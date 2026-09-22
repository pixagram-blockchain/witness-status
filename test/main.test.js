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


test('first staged paint assigns producer colors by witness rank', async () => {
  const snapshot = raw({ witnesses: [witness('rank-first', { votes: '2000' }), witness('block-first', { votes: '1000' })],
    blocks: [{ num: 1, witness: 'block-first', timestamp: '2026-09-04T12:00:03', txCount: 0 }] });
  const app = controller(Promise.resolve(DEFAULT_CONFIG), { fetchSnapshot: async (node, opts) => {
    opts.onUpdate?.({ ...snapshot, blocks: [] }, 'core');
    opts.onUpdate?.(snapshot, 'blocks');
    return snapshot;
  } });
  await app.refresh();
  assert.equal(app.state.colors.get('rank-first'), 1);
  assert.equal(app.state.colors.get('block-first'), 2);
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
