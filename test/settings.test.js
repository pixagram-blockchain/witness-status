import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, readSettings, settingsToQuery, writeSettings, STORAGE_KEY, WINDOWS, INTERVALS } from '../src/ui/settings.js';

const storage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), dump: () => Object.fromEntries(m) };
};
const stored = (o) => storage({ [STORAGE_KEY]: JSON.stringify(o) });

test('readSettings returns defaults with no input', () => {
  assert.deepEqual(readSettings('', null), DEFAULTS);
  assert.deepEqual(DEFAULTS, { node: 'https://api.pixagram.com', interval: 30, sort: 'rank', dir: 'asc', window: 300, q: '', hideDisabled: false });
});

test('readSettings prefers URL params over storage over defaults', () => {
  const s = readSettings('?interval=10', stored({ interval: 60, sort: 'totalMissed' }));
  assert.equal(s.interval, 10);
  assert.equal(s.sort, 'totalMissed');
  assert.equal(s.dir, 'asc');
});

test('readSettings rejects invalid values', () => {
  const s = readSettings('?interval=-5&window=250&dir=up&sort=nope&node=ftp://x', null);
  assert.deepEqual(s, DEFAULTS);
  assert.equal(readSettings('?interval=abc', null).interval, 30);
});

test('readSettings accepts interval 0 (paused) and 3600', () => {
  assert.equal(readSettings('?interval=0', null).interval, 0);
  assert.equal(readSettings('?interval=3600', null).interval, 3600);
  assert.equal(readSettings('?interval=3601', null).interval, 30);
});

test('readSettings accepts every listed window and a custom node', () => {
  for (const w of WINDOWS) assert.equal(readSettings(`?window=${w}`, null).window, w);
  assert.equal(readSettings('?node=https://rpc.example.org/', null).node, 'https://rpc.example.org/');
  assert.equal(readSettings('?node=http://localhost:8090', null).node, 'http://localhost:8090');
});

test('readSettings parses hideDisabled and q from URL and storage', () => {
  assert.equal(readSettings('?hideDisabled=1', null).hideDisabled, true);
  assert.equal(readSettings('', stored({ hideDisabled: true })).hideDisabled, true);
  assert.equal(readSettings('?hideDisabled=0', stored({ hideDisabled: true })).hideDisabled, false);
  assert.equal(readSettings('?q=Init', null).q, 'init');
  assert.equal(readSettings('?q=' + 'x'.repeat(100), null).q.length, 64);
});

test('readSettings tolerates corrupt storage JSON', () => {
  assert.deepEqual(readSettings('', storage({ [STORAGE_KEY]: '{oops' })), DEFAULTS);
});

test('settingsToQuery omits defaults', () => {
  assert.equal(settingsToQuery(DEFAULTS).toString(), '');
  assert.equal(settingsToQuery({ ...DEFAULTS, interval: 10, sort: 'totalMissed', dir: 'desc', hideDisabled: true }).toString(), 'interval=10&sort=totalMissed&dir=desc&hideDisabled=1');
  assert.equal(settingsToQuery({ ...DEFAULTS, interval: 0 }).toString(), 'interval=0');
});

test('writeSettings stores JSON and readSettings reads it back', () => {
  const st = storage();
  const s = { ...DEFAULTS, interval: 15, window: 1000, q: 'init' };
  writeSettings(s, st);
  assert.deepEqual(readSettings('', st), s);
});

test('INTERVALS contains the default', () => {
  assert.ok(INTERVALS.includes(30));
});
