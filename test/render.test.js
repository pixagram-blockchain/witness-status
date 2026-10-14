import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickAges, renderBlocks } from '../src/ui/render.js';
import { derive } from '../src/lib/derive.js';
import { raw, witness, blockId, blockTime, NULL_KEY } from './fixtures.js';

test('age ticking updates changed labels without replacing unchanged text', () => {
  let writes = 0;
  let text = '1h 0m ago';
  const el = { dataset: { ts: '0' }, get textContent() { return text; }, set textContent(value) { writes++; text = value; } };
  const root = { querySelectorAll: () => [el] };
  tickAges(root, 3600_000);
  assert.equal(writes, 0);
  tickAges(root, 3660_000);
  assert.equal(text, '1h 1m ago');
  assert.equal(writes, 1);
});

// Blocks at the given slot offsets (3 s apart), produced by the given witnesses in turn.
function laneModel(slots, producers, { witnesses, scheduled } = {}) {
  const ws = witnesses ?? [witness('alice', { votes: '3000' }), witness('bob', { votes: '2000' }), witness('carol', { votes: '1000' }), witness('dave', { votes: '500', signing_key: NULL_KEY })];
  const shuffled = scheduled ?? ['alice', 'bob', 'carol'];
  const blocks = slots.map((slot, i) => ({ num: 100 + i, id: blockId(100 + i), timestamp: blockTime(100 + slot), witness: producers[i % producers.length], txCount: i }));
  return derive(raw({ witnesses: ws, blocks, schedule: { current_shuffled_witnesses: [...shuffled, ...Array(21 - shuffled.length).fill('')], num_scheduled_witnesses: shuffled.length } }), { now: Date.parse(blockTime(100 + slots.at(-1)) + 'Z') });
}
const rows = (html) => [...html.matchAll(/<div class="lane-row[^"]*" data-lane="([^"]+)">(.*?)<\/div>/g)].map(([, lane, body]) => ({
  lane, marks: [...body.matchAll(/style="--i:(\d+)(?:;--n:(\d+))?"/g)].map(([, i, n]) => (n ? `${i}+${n}` : Number(i))),
  count: body.match(/<b[^>]*>(\d+)<\/b>/)?.[1],
}));

test('recent blocks render one lane per witness in rank order, marks placed by slot', () => {
  const html = renderBlocks(laneModel([0, 1, 2, 4, 5], ['alice', 'bob']));
  assert.match(html, /style="--slots:6"/);
  assert.deepEqual(rows(html), [
    { lane: 'missed', marks: ['3+1'], count: '1' },
    { lane: 'alice', marks: [0, 2, 5], count: '3' },
    { lane: 'bob', marks: [1, 4], count: '2' },
    { lane: 'carol', marks: [], count: '0' },
  ]);
});

test('a scheduled witness without blocks is flagged; a disabled one gets no lane', () => {
  const html = renderBlocks(laneModel([0, 1], ['alice', 'bob']));
  assert.match(html, /data-lane="carol">.*<b class="warn-text">0<\/b>/);
  assert.doesNotMatch(html, /data-lane="dave"/);
});

test('a run of missed slots is one mark, and no missed lane is drawn without misses', () => {
  assert.deepEqual(rows(renderBlocks(laneModel([0, 1, 5], ['alice'])))[0], { lane: 'missed', marks: ['2+3'], count: '3' });
  assert.equal(rows(renderBlocks(laneModel([0, 1, 2], ['alice']))).some((r) => r.lane === 'missed'), false);
});

test('a block producer missing from the witness list still gets a lane', () => {
  const html = renderBlocks(laneModel([0, 1], ['alice', 'zed']));
  assert.deepEqual(rows(html).map((r) => r.lane), ['alice', 'bob', 'carol', 'zed']);
});

test('every lane carries the same 21+ witnesses without running out of encodings', () => {
  const names = Array.from({ length: 21 }, (_, i) => `w${String(i).padStart(2, '0')}`);
  const ws = names.map((n, i) => witness(n, { votes: String(1000 - i) }));
  const slots = Array.from({ length: 63 }, (_, i) => i);
  const r = rows(renderBlocks(laneModel(slots, names, { witnesses: ws, scheduled: names })));
  assert.deepEqual(r.map((x) => x.lane), names);
  assert.ok(r.every((x) => x.marks.length === 3 && x.count === '3'));
});
