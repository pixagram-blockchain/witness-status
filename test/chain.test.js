import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchConfig, fetchCore, fetchExtras, fetchBlocks, fetchSnapshot, fetchVoters, blockNumFromId, DEFAULT_CONFIG } from '../src/lib/chain.js';
import { RpcError } from '../src/lib/rpc.js';
import { fakeNode } from './helpers.js';
import * as fx from './fixtures.js';

const NODE = 'https://node.test';
const rangeCalls = (calls) => calls.filter((c) => c.method === 'block_api.get_block_range').map((c) => c.params);

test('fetchConfig maps chain constants', async () => {
  const cfg = await fetchConfig(NODE, { fetchImpl: fakeNode(fx.handlers()) });
  assert.equal(cfg.blockInterval, 3);
  assert.equal(cfg.maxWitnesses, 21);
  assert.equal(cfg.shutdownThreshold, 28800);
  assert.equal(cfg.maxFeedAgeSec, 604800);
  assert.equal(cfg.genesisTime, fx.GENESIS);
  assert.equal(cfg.addressPrefix, 'PIX');
  assert.deepEqual(cfg.symbols, { liquid: 'PIXA', stable: 'PXS', vests: 'VESTS' });
});

test('fetchCore returns every core object and the witness list', async () => {
  const core = await fetchCore(NODE, { fetchImpl: fakeNode(fx.handlers()) });
  assert.equal(core.dgp.head_block_number, 0);
  assert.equal(core.witnesses[0].owner, 'initminer');
  assert.equal(core.witnessCount, 1);
  assert.equal(core.schedule.num_scheduled_witnesses, 1);
  assert.equal(core.feedHistory.current_median_history.quote, '102.000 PIXA');
  assert.equal(core.hardfork.current_hardfork_version, '0.0.0');
  assert.equal(core.version.blockchain_version, '1.28.7');
  assert.ok(core.latencyMs >= 0);
  assert.ok(core.fetchedAt > 0);
});

test('fetchCore pages the witness list when the first page is full', async () => {
  const witnesses = ['a', 'b', 'c', 'd', 'e'].map((n) => fx.witness(n));
  const calls = [];
  const core = await fetchCore(NODE, { fetchImpl: fakeNode(fx.handlers({ witnesses }), calls), pageSize: 3 });
  assert.deepEqual(core.witnesses.map((w) => w.owner), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(calls.filter((c) => c.method === 'database_api.list_witnesses').length, 3);
});

test('fetchCore throws RpcError when a core call fails', async () => {
  const h = fx.handlers({ handlers: { 'database_api.get_witness_schedule': () => { throw new Error('boom'); } } });
  await assert.rejects(fetchCore(NODE, { fetchImpl: fakeNode(h) }), (e) => e instanceof RpcError && /get_witness_schedule/.test(e.message));
});

test('fetchExtras maps accounts by name and counts votes per witness', async () => {
  const votes = [{ witness: 'w1', account: 'a' }, { witness: 'w1', account: 'b' }, { witness: 'w2', account: 'a' }];
  const x = await fetchExtras(NODE, ['w1', 'w2'], { fetchImpl: fakeNode(fx.handlers({ votes })) });
  assert.equal(x.accounts.w1.name, 'w1');
  assert.equal(x.accounts.w2.name, 'w2');
  assert.deepEqual(x.votes, { w1: 2, w2: 1 });
  assert.equal(x.votesTruncated, false);
  assert.deepEqual(x.errors, []);
});

test('fetchExtras follows vote pages and counts every vote', async () => {
  const votes = Array.from({ length: 2500 }, (_, i) => ({ witness: 'w1', account: 'acc' + String(i).padStart(5, '0') }));
  const x = await fetchExtras(NODE, ['w1'], { fetchImpl: fakeNode(fx.handlers({ votes })) });
  assert.equal(x.votes.w1, 2500);
  assert.equal(x.votesTruncated, false);
});

test('fetchExtras marks votes truncated after maxVotePages', async () => {
  const votes = Array.from({ length: 2500 }, (_, i) => ({ witness: 'w1', account: 'acc' + String(i).padStart(5, '0') }));
  const x = await fetchExtras(NODE, ['w1'], { fetchImpl: fakeNode(fx.handlers({ votes })), maxVotePages: 2 });
  assert.equal(x.votesTruncated, true);
  assert.equal(x.votes.w1, 1999);
});

test('fetchExtras returns accounts=null and an error when get_accounts fails', async () => {
  const h = fx.handlers({ handlers: { 'condenser_api.get_accounts': () => { throw new Error('nope'); } } });
  const x = await fetchExtras(NODE, ['w1'], { fetchImpl: fakeNode(h) });
  assert.equal(x.accounts, null);
  assert.deepEqual(x.votes, {});
  assert.match(x.errors[0], /get_accounts/);
});

test('fetchExtras returns votes=null and an error when list_witness_votes fails', async () => {
  const h = fx.handlers({ handlers: { 'database_api.list_witness_votes': () => { throw new Error('nope'); } } });
  const x = await fetchExtras(NODE, ['w1'], { fetchImpl: fakeNode(h) });
  assert.equal(x.votes, null);
  assert.equal(x.accounts.w1.name, 'w1');
  assert.match(x.errors[0], /list_witness_votes/);
});

test('fetchExtras sends no get_accounts call for an empty owner list', async () => {
  const calls = [];
  const x = await fetchExtras(NODE, [], { fetchImpl: fakeNode(fx.handlers(), calls) });
  assert.equal(calls.filter((c) => c.method === 'condenser_api.get_accounts').length, 0);
  assert.deepEqual(x.accounts, {});
});

test('blockNumFromId decodes the block number prefix', () => {
  assert.equal(blockNumFromId('000186a0' + '0'.repeat(32)), 100000);
});

test('fetchBlocks chunks requests at 1000 and maps block numbers', async () => {
  const calls = [];
  const blocks = await fetchBlocks(NODE, 1, 2500, { fetchImpl: fakeNode(fx.handlers({ txs: { 1: [{}, {}] } }), calls) });
  assert.deepEqual(rangeCalls(calls), [
    { starting_block_num: 1, count: 1000 }, { starting_block_num: 1001, count: 1000 }, { starting_block_num: 2001, count: 500 },
  ]);
  assert.equal(blocks.length, 2500);
  assert.deepEqual(blocks[0], { num: 1, timestamp: fx.blockTime(1), witness: 'initminer', txCount: 2 });
  assert.equal(blocks[2499].num, 2500);
});

test('fetchSnapshot keeps a rolling window and fetches only new blocks', async () => {
  const calls = [];
  const prevBlocks = Array.from({ length: 340 }, (_, i) => ({ num: i + 1, timestamp: fx.blockTime(i + 1), witness: 'initminer', txCount: 0 }));
  const snap = await fetchSnapshot(NODE, { window: 300, prevBlocks, fetchImpl: fakeNode(fx.handlers({ dgp: { head_block_number: 350 } }), calls) });
  assert.deepEqual(rangeCalls(calls), [{ starting_block_num: 341, count: 10 }]);
  assert.equal(snap.blocks.length, 300);
  assert.equal(snap.blocks[0].num, 51);
  assert.equal(snap.blocks[299].num, 350);
});

test('fetchSnapshot fetches the whole window on first load', async () => {
  const calls = [];
  const snap = await fetchSnapshot(NODE, { window: 300, fetchImpl: fakeNode(fx.handlers({ dgp: { head_block_number: 350 } }), calls) });
  assert.deepEqual(rangeCalls(calls), [{ starting_block_num: 51, count: 300 }]);
  assert.equal(snap.blocks.length, 300);
});

test('fetchSnapshot starts at block 1 when the chain is shorter than the window', async () => {
  const calls = [];
  const snap = await fetchSnapshot(NODE, { window: 300, fetchImpl: fakeNode(fx.handlers({ dgp: { head_block_number: 20 } }), calls) });
  assert.deepEqual(rangeCalls(calls), [{ starting_block_num: 1, count: 20 }]);
  assert.equal(snap.blocks.length, 20);
});

test('fetchSnapshot skips blocks when head is 0', async () => {
  const calls = [];
  const snap = await fetchSnapshot(NODE, { fetchImpl: fakeNode(fx.handlers(), calls) });
  assert.deepEqual(rangeCalls(calls), []);
  assert.deepEqual(snap.blocks, []);
  assert.equal(snap.core.witnesses[0].owner, 'initminer');
  assert.equal(snap.config.blockInterval, 3);
  assert.deepEqual(snap.errors, []);
});

test('fetchSnapshot records block errors without failing', async () => {
  const h = fx.handlers({ dgp: { head_block_number: 50 }, handlers: { 'block_api.get_block_range': () => { throw new Error('too slow'); } } });
  const snap = await fetchSnapshot(NODE, { fetchImpl: fakeNode(h) });
  assert.deepEqual(snap.blocks, []);
  assert.match(snap.errors[0], /get_block_range/);
});

test('fetchSnapshot uses DEFAULT_CONFIG when get_config fails', async () => {
  const h = fx.handlers({ handlers: { 'condenser_api.get_config': () => { throw new Error('nope'); } } });
  const snap = await fetchSnapshot(NODE, { fetchImpl: fakeNode(h) });
  assert.equal(snap.config, DEFAULT_CONFIG);
  assert.match(snap.errors[0], /get_config/);
});

test('fetchSnapshot reuses a provided config without calling get_config', async () => {
  const calls = [];
  const snap = await fetchSnapshot(NODE, { config: DEFAULT_CONFIG, fetchImpl: fakeNode(fx.handlers(), calls) });
  assert.equal(calls.filter((c) => c.method === 'condenser_api.get_config').length, 0);
  assert.equal(snap.config, DEFAULT_CONFIG);
});

test('fetchSnapshot degrades extras when they fail', async () => {
  const h = fx.handlers({ handlers: {
    'condenser_api.get_accounts': () => { throw new Error('a'); },
    'database_api.list_witness_votes': () => { throw new Error('v'); },
  } });
  const snap = await fetchSnapshot(NODE, { fetchImpl: fakeNode(h) });
  assert.equal(snap.extras.accounts, null);
  assert.equal(snap.extras.votes, null);
  assert.equal(snap.errors.length, 2);
});

test('fetchVoters returns voters of one witness sorted by effective stake', async () => {
  const votes = [{ witness: 'w1', account: 'a' }, { witness: 'w1', account: 'b' }, { witness: 'w2', account: 'c' }];
  const accounts = {
    a: fx.account('a', { vesting_shares: '5.000000 VESTS', proxied_vsf_votes: [1000000, 0, 0, 0] }),
    b: fx.account('b', { vesting_shares: '10.000000 VESTS' }),
  };
  const r = await fetchVoters(NODE, 'w1', { fetchImpl: fakeNode(fx.handlers({ votes, accounts })) });
  assert.equal(r.total, 2);
  assert.deepEqual(r.voters.map((v) => [v.account, v.vests, v.proxiedVests, v.effectiveVests]), [['b', 10, 0, 10], ['a', 5, 1, 6]]);
});

test('fetchVoters caps the accounts it loads at limit', async () => {
  const votes = Array.from({ length: 5 }, (_, i) => ({ witness: 'w1', account: 'v' + i }));
  const r = await fetchVoters(NODE, 'w1', { limit: 2, fetchImpl: fakeNode(fx.handlers({ votes })) });
  assert.equal(r.total, 5);
  assert.equal(r.voters.length, 2);
});
