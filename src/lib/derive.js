// Pure derivation of the dashboard model from a raw snapshot. No I/O here.
import { parseAsset, parseUtc, isEpoch } from './assets.js';
import { deltaSince } from './history.js';

// The null public key (33 zero bytes) encodes as the prefix followed by 33 '1' characters.
export function isNullKey(key) {
  return typeof key === 'string' && /^[A-Za-z]{3}1{30,}/.test(key);
}

// recent_slots_filled is a 128-bit mask, bit 0 = newest slot. Returns oldest → newest.
export function decodeRecentSlots(str) {
  let v = BigInt(str);
  const bits = new Array(128);
  for (let i = 127; i >= 0; i--) {
    bits[i] = (v & 1n) === 1n;
    v >>= 1n;
  }
  return bits;
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Is the chain producing blocks? Head age is the primary signal (works from one sample);
// the previous sample adds an observed block rate, only trusted over a long enough window.
export function networkStatus({ headBlock, headAgeSec, blockInterval, prev, now }) {
  if (!headBlock) return { status: 'not_started', rate: null };
  let rate = null;
  if (prev?.network?.headBlock != null && prev.fetchedAt != null) {
    const elapsedSec = (now - prev.fetchedAt) / 1000;
    if (elapsedSec > 0) {
      const headDelta = headBlock - prev.network.headBlock;
      const observed = headDelta / elapsedSec;
      const expected = 1 / blockInterval;
      rate = { observed, expected, ratio: observed / expected, headDelta, elapsedSec };
    }
  }
  let status = 'progressing';
  if (headAgeSec > 60 || (rate && rate.elapsedSec >= 15 && rate.headDelta === 0)) status = 'stalled';
  else if (headAgeSec > 3 * blockInterval || (rate && rate.elapsedSec >= 30 && rate.ratio < 0.8)) status = 'lagging';
  return { status, rate };
}

// Per-block gaps (missed slots before each block) and per-witness production counts.
export function blockWindowStats(blocks, blockInterval) {
  const window = [];
  const perWitness = {};
  let txTotal = 0;
  let missedSlotsInWindow = 0;
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    let gapBefore = 0;
    if (i > 0) {
      const dt = (parseUtc(blk.timestamp) - parseUtc(blocks[i - 1].timestamp)) / 1000;
      gapBefore = Math.max(0, Math.round(dt / blockInterval) - 1);
    }
    missedSlotsInWindow += gapBefore;
    txTotal += blk.txCount;
    perWitness[blk.witness] = (perWitness[blk.witness] ?? 0) + 1;
    window.push({ ...blk, gapBefore });
  }
  const spanSec = blocks.length > 1 ? (parseUtc(blocks[blocks.length - 1].timestamp) - parseUtc(blocks[0].timestamp)) / 1000 : 0;
  return { window, perWitness, txTotal, missedSlotsInWindow, spanSec, first: blocks[0]?.num ?? null, last: blocks[blocks.length - 1]?.num ?? null };
}

// {base, quote} → PIXA per PXS, or null when the feed is unset.
function priceOf(p) {
  if (!p) return null;
  const base = parseAsset(p.base);
  const quote = parseAsset(p.quote);
  return base && quote && base.amount > 0 && quote.amount > 0 ? quote.amount / base.amount : null;
}

const byVotesThenName = (a, b) => Number(b.votes) - Number(a.votes) || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0);

export function derive(raw, { now = Date.now(), prev = null, history = null, sessionBase = null } = {}) {
  const { config: cfg, core, extras, blocks } = raw;
  const { dgp, schedule, feedHistory, hardfork, version } = core;
  const bi = cfg.blockInterval;
  const headBlock = dgp.head_block_number;
  const headAgeSec = (now - parseUtc(dgp.time)) / 1000;
  const totalVests = parseAsset(dgp.total_vesting_shares).amount;
  const totalFund = parseAsset(dgp.total_vesting_fund_pixa).amount;
  const vestingRatio = totalVests > 0 ? totalFund / totalVests : 1;
  const medianPrice = priceOf(feedHistory.current_median_history);
  const shuffled = schedule.current_shuffled_witnesses.filter(Boolean);
  const scheduled = new Set(shuffled);
  const n = schedule.num_scheduled_witnesses;
  const currentAslot = dgp.current_aslot;
  const majority = schedule.majority_version;
  const mp = schedule.median_props;
  const medianProps = {
    accountCreationFee: parseAsset(mp.account_creation_fee).amount, maxBlockSize: mp.maximum_block_size, pxsInterestRate: mp.pxs_interest_rate,
    subsidyBudget: mp.account_subsidy_budget, subsidyDecay: mp.account_subsidy_decay,
  };
  const stats = blockWindowStats(blocks, bi);
  const votesTotal = core.witnesses.reduce((s, w) => s + Number(w.votes), 0);
  const prevMissed = prev?.witnesses ? Object.fromEntries(prev.witnesses.map((w) => [w.owner, w.totalMissed])) : null;

  const witnesses = [...core.witnesses].sort(byVotesThenName).map((w, i) => {
    const votes = Number(w.votes);
    const votesVests = votes / 1e6;
    const disabled = isNullKey(w.signing_key);
    const lastConfirmed = w.last_confirmed_block_num;
    const blocksSinceConfirmed = lastConfirmed > 0 ? headBlock - lastConfirmed : null;
    const feedPrice = priceOf(w.pxs_exchange_rate);
    const feedNever = isEpoch(w.last_pxs_exchange_update);
    const feedAgeSec = feedNever ? null : (now - parseUtc(w.last_pxs_exchange_update)) / 1000;
    const acc = extras.accounts?.[w.owner] ?? null;
    const produced = stats.perWitness[w.owner] ?? 0;
    return {
      owner: w.owner, id: w.id, rank: i + 1,
      status: disabled ? 'disabled' : scheduled.has(w.owner) ? 'active' : 'standby',
      disabled, isCurrentProducer: w.owner === dgp.current_witness,
      votes, votesVests, votesPixa: votesVests * vestingRatio, voteShare: votesTotal ? votes / votesTotal : 0,
      voters: extras.votes ? (extras.votes[w.owner] ?? 0) : null, votersTruncated: !!extras.votesTruncated,
      totalMissed: w.total_missed,
      missedSincePrev: prevMissed ? w.total_missed - (prevMissed[w.owner] ?? w.total_missed) : null,
      missedSinceLoad: sessionBase ? w.total_missed - (sessionBase[w.owner] ?? w.total_missed) : null,
      missed1h: history ? deltaSince(history, w.owner, w.total_missed, 3600, now) : null,
      missed24h: history ? deltaSince(history, w.owner, w.total_missed, 86400, now) : null,
      lastConfirmedBlock: lastConfirmed || null, blocksSinceConfirmed,
      secondsSinceConfirmed: blocksSinceConfirmed == null ? null : blocksSinceConfirmed * bi,
      shutdownRisk: !disabled && blocksSinceConfirmed != null && blocksSinceConfirmed > cfg.shutdownThreshold,
      lastAslot: w.last_aslot, slotsSinceLast: w.last_aslot ? currentAslot - w.last_aslot : null,
      producedInWindow: produced, windowShare: blocks.length ? produced / blocks.length : 0,
      feed: {
        price: feedPrice, base: parseAsset(w.pxs_exchange_rate.base), quote: parseAsset(w.pxs_exchange_rate.quote),
        updatedAt: feedNever ? null : w.last_pxs_exchange_update, ageSec: feedAgeSec,
        deviationPct: feedPrice != null && medianPrice ? ((feedPrice - medianPrice) / medianPrice) * 100 : null,
        stale: feedPrice == null || feedNever || feedAgeSec > cfg.maxFeedAgeSec,
      },
      version: { running: w.running_version, behind: compareVersions(w.running_version, majority) < 0 },
      hfVote: { version: w.hardfork_version_vote, time: w.hardfork_time_vote },
      props: {
        accountCreationFee: parseAsset(w.props.account_creation_fee).amount, maxBlockSize: w.props.maximum_block_size,
        pxsInterestRate: w.props.pxs_interest_rate, subsidyBudget: w.props.account_subsidy_budget, subsidyDecay: w.props.account_subsidy_decay,
        maxBlockSizeDiffers: w.props.maximum_block_size !== medianProps.maxBlockSize,
      },
      signingKey: w.signing_key, url: w.url, created: isEpoch(w.created) ? null : w.created,
      virtual: { lastUpdate: w.virtual_last_update, position: w.virtual_position, scheduledTime: w.virtual_scheduled_time },
      availableSubsidies: w.available_witness_account_subsidies,
      account: acc && {
        vests: parseAsset(acc.vesting_shares).amount, delegatedVests: parseAsset(acc.delegated_vesting_shares).amount,
        receivedVests: parseAsset(acc.received_vesting_shares).amount, pixa: parseAsset(acc.balance).amount, pxs: parseAsset(acc.pxs_balance).amount,
        witnessesVotedFor: acc.witnesses_voted_for, proxy: acc.proxy, created: acc.created,
      },
    };
  });

  const counts = { total: witnesses.length, active: 0, standby: 0, disabled: 0, reported: core.witnessCount };
  for (const w of witnesses) counts[w.status]++;

  const net = networkStatus({ headBlock, headAgeSec, blockInterval: bi, prev, now });
  const genesisTime = cfg.genesisTime ?? (headBlock === 0 ? dgp.time : null);
  const network = {
    status: net.status, rate: net.rate, headBlock, headBlockId: dgp.head_block_id, headTime: dgp.time, headAgeSec,
    lib: dgp.last_irreversible_block_num, libLag: headBlock - dgp.last_irreversible_block_num, currentWitness: dgp.current_witness,
    currentAslot, missedSlotsTotal: currentAslot - headBlock, participationCount: dgp.participation_count,
    participationPct: (dgp.participation_count / 128) * 100, recentSlots: decodeRecentSlots(dgp.recent_slots_filled),
    genesisTime, genesisInSec: headBlock === 0 && genesisTime ? (parseUtc(genesisTime) - now) / 1000 : null,
  };

  const chain = {
    blockInterval: bi, maxWitnesses: cfg.maxWitnesses, shutdownThreshold: cfg.shutdownThreshold, maxFeedAgeSec: cfg.maxFeedAgeSec,
    addressPrefix: cfg.addressPrefix, nodeVersion: version.blockchain_version, nodeRevision: version.hive_revision, chainId: version.chain_id,
    majorityVersion: majority, hfCurrent: hardfork.current_hardfork_version, hfLast: hardfork.last_hardfork, hfNext: hardfork.next_hardfork,
    hfNextTime: isEpoch(hardfork.next_hardfork_time) ? null : hardfork.next_hardfork_time,
    hardforkRequiredWitnesses: schedule.hardfork_required_witnesses, vestingRatio, totalVests, totalVestingFundPixa: totalFund,
    medianFeed: { price: medianPrice, base: parseAsset(feedHistory.current_median_history?.base), quote: parseAsset(feedHistory.current_median_history?.quote) },
    marketMedian: priceOf(feedHistory.market_median_history), minFeed: priceOf(feedHistory.current_min_history), maxFeed: priceOf(feedHistory.current_max_history),
    feedCount: feedHistory.price_history?.length ?? 0, medianProps,
    supply: { pixa: parseAsset(dgp.current_supply).amount, pxs: parseAsset(dgp.current_pxs_supply).amount, virtual: parseAsset(dgp.virtual_supply).amount },
    maxBlockSize: dgp.maximum_block_size, pxsPrintRate: dgp.pxs_print_rate, pxsInterestRate: dgp.pxs_interest_rate,
  };

  const scheduleModel = {
    shuffled, n, currentIndex: n ? currentAslot % n : null, nextIndex: n ? (currentAslot + 1) % n : null,
    nextShuffleBlock: schedule.next_shuffle_block_num, blocksToShuffle: schedule.next_shuffle_block_num - headBlock,
    maxVoted: schedule.max_voted_witnesses, maxRunner: schedule.max_runner_witnesses, maxMiner: schedule.max_miner_witnesses,
    electedWeight: schedule.elected_weight, timeshareWeight: schedule.timeshare_weight,
  };

  return {
    fetchedAt: core.fetchedAt, node: raw.node, latencyMs: core.latencyMs, network, chain, schedule: scheduleModel, counts, witnesses,
    blocks: { ...stats, windowSize: blocks.length }, errors: raw.errors ?? [],
  };
}
