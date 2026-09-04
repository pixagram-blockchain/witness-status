import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNullKey, decodeRecentSlots, compareVersions, networkStatus, blockWindowStats, derive } from '../src/lib/derive.js';
import * as fx from './fixtures.js';

const G = Date.parse(fx.GENESIS + 'Z');
const NOW = G + 3600_000; // one hour after genesis
const ALL = '340282366920938463463374607431768211455';
const b = (num, sec, witness, txCount) => ({ num, timestamp: new Date(G + sec * 1000).toISOString().slice(0, 19), witness, txCount });
const byOwner = (m) => Object.fromEntries(m.witnesses.map((w) => [w.owner, w]));
const shuffled = (names) => [...names, ...Array(21 - names.length).fill('')];

test('isNullKey recognises the PIX null key and rejects real keys', () => {
  assert.equal(isNullKey(fx.NULL_KEY), true);
  assert.equal(isNullKey(fx.KEY), false);
  assert.equal(isNullKey(''), false);
});

test('decodeRecentSlots puts the newest slot last and decodes 2^128-1 as all filled', () => {
  const all = decodeRecentSlots(ALL);
  assert.equal(all.length, 128);
  assert.ok(all.every(Boolean));
  const one = decodeRecentSlots('340282366920938463463374607431768211454');
  assert.equal(one[127], false);
  assert.equal(one[126], true);
});

test('compareVersions orders semantic versions numerically', () => {
  assert.equal(compareVersions('1.28.10', '1.28.7'), 1);
  assert.equal(compareVersions('1.27.9', '1.28.0'), -1);
  assert.equal(compareVersions('1.28.7', '1.28.7'), 0);
});

test('networkStatus is not_started at head 0', () => {
  assert.equal(networkStatus({ headBlock: 0, headAgeSec: -3600, blockInterval: 3, prev: null, now: NOW }).status, 'not_started');
});

test('networkStatus is progressing when head age is small', () => {
  assert.equal(networkStatus({ headBlock: 100, headAgeSec: 2, blockInterval: 3, prev: null, now: NOW }).status, 'progressing');
});

test('networkStatus is lagging when head age exceeds 3 block intervals', () => {
  assert.equal(networkStatus({ headBlock: 100, headAgeSec: 10, blockInterval: 3, prev: null, now: NOW }).status, 'lagging');
});

test('networkStatus is stalled when head age exceeds 60 s', () => {
  assert.equal(networkStatus({ headBlock: 100, headAgeSec: 61, blockInterval: 3, prev: null, now: NOW }).status, 'stalled');
});

test('networkStatus is stalled when no block arrived over 15 s', () => {
  const prev = { fetchedAt: NOW - 20_000, network: { headBlock: 100 } };
  const r = networkStatus({ headBlock: 100, headAgeSec: 5, blockInterval: 3, prev, now: NOW });
  assert.equal(r.status, 'stalled');
  assert.equal(r.rate.headDelta, 0);
});

test('networkStatus computes the observed rate ratio from the previous sample', () => {
  const prev = { fetchedAt: NOW - 30_000, network: { headBlock: 90 } };
  const r = networkStatus({ headBlock: 100, headAgeSec: 2, blockInterval: 3, prev, now: NOW });
  assert.equal(r.status, 'progressing');
  assert.ok(Math.abs(r.rate.ratio - 1) < 1e-9);
  assert.equal(r.rate.headDelta, 10);
  assert.equal(r.rate.elapsedSec, 30);
  assert.ok(Math.abs(r.rate.expected - 1 / 3) < 1e-9);
});

test('networkStatus is lagging when the observed rate drops below 80 %', () => {
  const prev = { fetchedAt: NOW - 60_000, network: { headBlock: 90 } };
  assert.equal(networkStatus({ headBlock: 100, headAgeSec: 2, blockInterval: 3, prev, now: NOW }).status, 'lagging');
});

test('networkStatus ignores the ratio when the elapsed time is short', () => {
  const prev = { fetchedAt: NOW - 5_000, network: { headBlock: 99 } };
  assert.equal(networkStatus({ headBlock: 100, headAgeSec: 2, blockInterval: 3, prev, now: NOW }).status, 'progressing');
});

test('blockWindowStats counts per witness, tx totals and missed gaps', () => {
  const s = blockWindowStats([b(1, 0, 'a', 2), b(2, 3, 'b', 0), b(3, 9, 'a', 1), b(4, 12, 'c', 0)], 3);
  assert.deepEqual(s.window.map((x) => x.gapBefore), [0, 0, 1, 0]);
  assert.equal(s.missedSlotsInWindow, 1);
  assert.equal(s.txTotal, 3);
  assert.deepEqual(s.perWitness, { a: 2, b: 1, c: 1 });
  assert.equal(s.spanSec, 12);
  assert.equal(s.first, 1);
  assert.equal(s.last, 4);
});

test('blockWindowStats handles an empty window', () => {
  const s = blockWindowStats([], 3);
  assert.equal(s.first, null);
  assert.equal(s.last, null);
  assert.equal(s.spanSec, 0);
  assert.deepEqual(s.perWitness, {});
});

test('derive ranks witnesses by votes then name and computes stake in PIXA', () => {
  const witnesses = [fx.witness('bob', { votes: '1000000000000' }), fx.witness('alice', { votes: '2000000000000' }), fx.witness('carol', { votes: '1000000000000' })];
  const m = derive(fx.raw({ witnesses, dgp: { total_vesting_fund_pixa: '200.000 PIXA', total_vesting_shares: '100.000000 VESTS' } }), { now: NOW });
  assert.deepEqual(m.witnesses.map((w) => [w.rank, w.owner]), [[1, 'alice'], [2, 'bob'], [3, 'carol']]);
  assert.equal(m.witnesses[0].votesVests, 2_000_000);
  assert.equal(m.witnesses[0].votesPixa, 4_000_000);
  assert.equal(m.witnesses[0].voteShare, 0.5);
  assert.equal(m.chain.vestingRatio, 2);
});

test('derive marks disabled, active and standby status', () => {
  const witnesses = [fx.witness('a'), fx.witness('b'), fx.witness('c', { signing_key: fx.NULL_KEY })];
  const m = derive(fx.raw({ witnesses, schedule: { current_shuffled_witnesses: shuffled(['a']), num_scheduled_witnesses: 1 } }), { now: NOW });
  assert.deepEqual(Object.fromEntries(m.witnesses.map((w) => [w.owner, w.status])), { a: 'active', b: 'standby', c: 'disabled' });
  assert.equal(byOwner(m).c.disabled, true);
  assert.deepEqual(m.counts, { total: 3, active: 1, standby: 1, disabled: 1, reported: 3 });
});

test('derive flags the current producer', () => {
  const m = derive(fx.raw({ witnesses: [fx.witness('a'), fx.witness('b')], dgp: { current_witness: 'b' } }), { now: NOW });
  assert.deepEqual(m.witnesses.map((w) => [w.owner, w.isCurrentProducer]), [['a', false], ['b', true]]);
});

test('derive computes feed price, age, deviation and staleness', () => {
  const w = fx.witness('a', {
    pxs_exchange_rate: { base: { amount: '1000', precision: 3, nai: '@@000000013' }, quote: { amount: '110000', precision: 3, nai: '@@000000021' } },
    last_pxs_exchange_update: '2026-09-04T12:30:00',
  });
  const f = derive(fx.raw({ witnesses: [w] }), { now: NOW }).witnesses[0].feed;
  assert.equal(f.price, 110);
  assert.equal(f.ageSec, 1800);
  assert.equal(f.updatedAt, '2026-09-04T12:30:00');
  assert.ok(Math.abs(f.deviationPct - 7.8431) < 0.001);
  assert.equal(f.stale, false);
});

test('derive marks a feed stale after the max feed age', () => {
  const w = fx.witness('a', {
    pxs_exchange_rate: { base: { amount: '1000', precision: 3, nai: '@@000000013' }, quote: { amount: '110000', precision: 3, nai: '@@000000021' } },
    last_pxs_exchange_update: '2026-08-20T12:00:00',
  });
  const f = derive(fx.raw({ witnesses: [w] }), { now: NOW }).witnesses[0].feed;
  assert.equal(f.price, 110);
  assert.equal(f.stale, true);
});

test('derive reports a missing feed when base or quote is zero', () => {
  const m = derive(fx.raw(), { now: NOW });
  const f = m.witnesses[0].feed;
  assert.equal(f.price, null);
  assert.equal(f.ageSec, null);
  assert.equal(f.updatedAt, null);
  assert.equal(f.deviationPct, null);
  assert.equal(f.stale, true);
  assert.equal(m.chain.medianFeed.price, 102);
});

test('derive computes missed deltas from prev, sessionBase and history', () => {
  const w = fx.witness('a', { total_missed: 10 });
  const prev = { fetchedAt: NOW - 30_000, network: { headBlock: 0 }, witnesses: [{ owner: 'a', totalMissed: 8 }] };
  const history = [{ t: NOW - 7200_000, missed: { a: 3 } }, { t: NOW - 1800_000, missed: { a: 9 } }];
  const x = derive(fx.raw({ witnesses: [w] }), { now: NOW, prev, history, sessionBase: { a: 5 } }).witnesses[0];
  assert.equal(x.missedSincePrev, 2);
  assert.equal(x.missedSinceLoad, 5);
  assert.deepEqual(x.missed1h, { delta: 7, partial: false, sinceT: NOW - 7200_000 });
  assert.deepEqual(x.missed24h, { delta: 7, partial: true, sinceT: NOW - 7200_000 });
});

test('derive leaves deltas null without prev, sessionBase or history', () => {
  const x = derive(fx.raw(), { now: NOW }).witnesses[0];
  assert.equal(x.missedSincePrev, null);
  assert.equal(x.missedSinceLoad, null);
  assert.equal(x.missed1h, null);
  assert.equal(x.missed24h, null);
});

test('derive marks shutdownRisk when blocks since confirmed exceed the threshold', () => {
  const witnesses = [fx.witness('a', { last_confirmed_block_num: 100 }), fx.witness('b', { last_confirmed_block_num: 29000 }), fx.witness('c')];
  const by = byOwner(derive(fx.raw({ witnesses, dgp: { head_block_number: 30000, time: '2026-09-04T12:59:58' } }), { now: NOW }));
  assert.equal(by.a.blocksSinceConfirmed, 29900);
  assert.equal(by.a.secondsSinceConfirmed, 89700);
  assert.equal(by.a.shutdownRisk, true);
  assert.equal(by.b.shutdownRisk, false);
  assert.equal(by.c.blocksSinceConfirmed, null);
  assert.equal(by.c.lastConfirmedBlock, null);
  assert.equal(by.c.shutdownRisk, false);
});

test('derive reports schedule indices from the current aslot', () => {
  const m = derive(fx.raw({
    witnesses: [fx.witness('a'), fx.witness('b'), fx.witness('c')],
    dgp: { head_block_number: 7, current_aslot: 7, time: '2026-09-04T12:59:58' },
    schedule: { current_shuffled_witnesses: shuffled(['a', 'b', 'c']), num_scheduled_witnesses: 3, next_shuffle_block_num: 9 },
  }), { now: NOW });
  assert.deepEqual(m.schedule.shuffled, ['a', 'b', 'c']);
  assert.equal(m.schedule.n, 3);
  assert.equal(m.schedule.currentIndex, 1);
  assert.equal(m.schedule.nextIndex, 2);
  assert.equal(m.schedule.nextShuffleBlock, 9);
  assert.equal(m.schedule.blocksToShuffle, 2);
});

test('derive counts voters, maps accounts and tolerates missing extras', () => {
  const witnesses = [fx.witness('a'), fx.witness('b')];
  const accounts = { a: fx.account('a', { vesting_shares: '12.500000 VESTS', balance: '1.000 PIXA', pxs_balance: '2.000 PXS', witnesses_voted_for: 3, proxy: 'x' }) };
  const by = byOwner(derive(fx.raw({ witnesses, accounts, votes: { a: 4 } }), { now: NOW }));
  assert.equal(by.a.voters, 4);
  assert.equal(by.b.voters, 0);
  assert.equal(by.a.account.vests, 12.5);
  assert.equal(by.a.account.pixa, 1);
  assert.equal(by.a.account.pxs, 2);
  assert.equal(by.a.account.witnessesVotedFor, 3);
  assert.equal(by.a.account.proxy, 'x');
  assert.equal(by.b.account, null);
  const m2 = derive(fx.raw({ witnesses, accounts: null, votes: null }), { now: NOW });
  assert.equal(m2.witnesses[0].voters, null);
  assert.equal(m2.witnesses[0].account, null);
});

test('derive computes global counts, participation and missed slots total', () => {
  const m = derive(fx.raw({ dgp: {
    head_block_number: 1000, current_aslot: 1010, participation_count: 120, recent_slots_filled: '340282366920938463463374607431768211454',
    last_irreversible_block_num: 990, time: '2026-09-04T12:59:58',
  } }), { now: NOW });
  assert.equal(m.network.headBlock, 1000);
  assert.equal(m.network.missedSlotsTotal, 10);
  assert.equal(m.network.participationPct, 93.75);
  assert.equal(m.network.participationCount, 120);
  assert.equal(m.network.libLag, 10);
  assert.equal(m.network.recentSlots[127], false);
  assert.equal(m.network.headAgeSec, 2);
  assert.equal(m.network.status, 'progressing');
  assert.equal(m.network.genesisInSec, null);
});

test('derive computes genesisInSec before the chain starts', () => {
  const m = derive(fx.raw(), { now: G - 3600_000 });
  assert.equal(m.network.status, 'not_started');
  assert.equal(m.network.genesisInSec, 3600);
  assert.equal(m.network.genesisTime, fx.GENESIS);
});

test('derive reports version, hardfork and median props', () => {
  const w = fx.witness('a', { running_version: '1.28.6', hardfork_version_vote: '1.28.0', hardfork_time_vote: '2026-10-01T00:00:00', props: { ...fx.witness('a').props, maximum_block_size: 65536 } });
  const m = derive(fx.raw({ witnesses: [w], schedule: { majority_version: '1.28.7' }, hardfork: { next_hardfork: '1.28.0', next_hardfork_time: '2026-10-01T00:00:00' } }), { now: NOW });
  assert.equal(m.witnesses[0].version.running, '1.28.6');
  assert.equal(m.witnesses[0].version.behind, true);
  assert.equal(m.chain.majorityVersion, '1.28.7');
  assert.equal(m.chain.nodeVersion, '1.28.7');
  assert.equal(m.chain.hfNext, '1.28.0');
  assert.equal(m.chain.hfNextTime, '2026-10-01T00:00:00');
  assert.equal(m.chain.medianProps.maxBlockSize, 262144);
  assert.equal(m.chain.medianProps.accountCreationFee, 0);
  assert.deepEqual(m.witnesses[0].hfVote, { version: '1.28.0', time: '2026-10-01T00:00:00' });
  assert.equal(m.witnesses[0].props.maxBlockSize, 65536);
  assert.equal(m.witnesses[0].props.maxBlockSizeDiffers, true);
});

test('derive includes block window stats and per-witness production', () => {
  const blocks = [b(1, 0, 'a', 0), b(2, 3, 'a', 0), b(3, 6, 'b', 0)];
  const m = derive(fx.raw({ witnesses: [fx.witness('a'), fx.witness('b')], blocks, dgp: { head_block_number: 3, time: '2026-09-04T12:59:58' } }), { now: NOW });
  assert.equal(m.witnesses[0].producedInWindow, 2);
  assert.ok(Math.abs(m.witnesses[0].windowShare - 2 / 3) < 1e-9);
  assert.equal(m.blocks.windowSize, 3);
  assert.deepEqual(m.blocks.perWitness, { a: 2, b: 1 });
});

test('derive carries node, latency, fetch time and errors', () => {
  const m = derive(fx.raw({ fetchedAt: 123, errors: ['x'] }), { now: NOW });
  assert.equal(m.node, 'https://node.test');
  assert.equal(m.latencyMs, 100);
  assert.equal(m.fetchedAt, 123);
  assert.deepEqual(m.errors, ['x']);
});
