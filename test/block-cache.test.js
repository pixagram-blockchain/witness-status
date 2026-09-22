import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBlockCache, saveBlockCache } from '../src/lib/block-cache.js';
import { raw, blockId, blockTime } from './fixtures.js';
const node = 'https://node.test';
const now = 100000;
const blocks = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ num: from + i, id: blockId(from + i), timestamp: blockTime(from + i), witness: 'initminer', txCount: 0 }));
function storage() {
  const data = new Map();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
}
test('block cache stores only finalized summaries and is isolated by node', () => {
  const s = storage();
  saveBlockCache(s, node, raw({ blocks: blocks(1, 100), dgp: { head_block_number: 100, last_irreversible_block_num: 80 } }), now);
  const cached = loadBlockCache(s, node, now);
  assert.equal(cached.blocks.length, 80);
  assert.equal(cached.blocks.at(-1).num, 80);
  assert.equal(cached.chainId, '0'.repeat(64));
  assert.equal(loadBlockCache(s, 'https://other', now), null);
});
test('block cache rejects expired, future-dated, malformed and disordered data', () => {
  const s = storage();
  saveBlockCache(s, node, raw({ blocks: blocks(1, 3), dgp: { last_irreversible_block_num: 3 } }), now);
  assert.equal(loadBlockCache(s, node, now + 86400001), null);
  assert.equal(loadBlockCache(s, node, now - 1), null);
  const [key, value] = [...s.data][0];
  const parsed = JSON.parse(value);
  parsed.blocks.reverse();
  s.setItem(key, JSON.stringify(parsed));
  assert.equal(loadBlockCache(s, node, now), null);
  s.setItem(key, '{');
  assert.equal(loadBlockCache(s, node, now), null);
});
test('block cache bounds storage to 1000 and ignores unavailable storage', () => {
  const s = storage();
  const snapshot = raw({ blocks: blocks(1, 1100), dgp: { last_irreversible_block_num: 1100 } });
  saveBlockCache(s, node, snapshot, now);
  assert.equal(loadBlockCache(s, node, now).blocks.length, 1000);
  const broken = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.equal(loadBlockCache(broken, node, now), null);
  assert.doesNotThrow(() => saveBlockCache(broken, node, snapshot, now));
});
