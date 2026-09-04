// Fixtures modelled on real api.pixagram.com responses at block 0 (2026-09-04).
import { DEFAULT_CONFIG } from '../src/lib/chain.js';

export const GENESIS = '2026-09-04T12:00:00';
export const KEY = 'PIX7J9nSaLkdSgcXufXmdn8Gm686rhbt9P8nJDzpePykUHSqZmw7Y';
export const NULL_KEY = 'PIX1111111111111111111111111111111114T1Anm';
const ALL_FILLED = '340282366920938463463374607431768211455';
const nai = (amount, precision, sym) => ({ amount: String(amount), precision, nai: sym });
const PIXA = '@@000000021';
const PXS = '@@000000013';

export function dgp(o = {}) {
  return {
    head_block_number: 0, head_block_id: '0000000000000000000000000000000000000000', time: GENESIS, current_witness: 'initminer',
    total_pow: '18446744073709551615', num_pow_witnesses: 0, virtual_supply: '124999999.978 PIXA', current_supply: '100000000.000 PIXA',
    init_pxs_supply: '0.000 PXS', current_pxs_supply: '245098.039 PXS', total_vesting_fund_pixa: '100000000.000 PIXA',
    total_vesting_shares: '100000000.000000 VESTS', total_reward_fund_pixa: '0.000 PIXA', total_reward_shares2: '0',
    pending_rewarded_vesting_shares: '0.000000 VESTS', pending_rewarded_vesting_pixa: '0.000 PIXA', pxs_interest_rate: 0,
    pxs_print_rate: 10000, maximum_block_size: 2097152, current_aslot: 0, recent_slots_filled: ALL_FILLED, participation_count: 128,
    last_irreversible_block_num: 0, vote_power_reserve_rate: 40, ...o,
  };
}

export function schedule(o = {}) {
  return {
    id: 0, current_virtual_time: '0', next_shuffle_block_num: 1,
    current_shuffled_witnesses: ['initminer', ...Array(20).fill('')], num_scheduled_witnesses: 1,
    elected_weight: 1, timeshare_weight: 5, miner_weight: 1, witness_pay_normalization_factor: 25,
    median_props: { account_creation_fee: nai(0, 3, PIXA), maximum_block_size: 262144, pxs_interest_rate: 0, account_subsidy_budget: 797, account_subsidy_decay: 347321 },
    majority_version: '0.0.0', max_voted_witnesses: 19, max_miner_witnesses: 1, max_runner_witnesses: 1, hardfork_required_witnesses: 17, ...o,
  };
}

// database_api.list_witnesses shape (NAI assets).
export function witness(owner, o = {}) {
  return {
    id: 0, owner, created: '1970-01-01T00:00:00', url: '', votes: 0, virtual_last_update: '0', virtual_position: '0',
    virtual_scheduled_time: ALL_FILLED, total_missed: 0, last_aslot: 0, last_confirmed_block_num: 0, pow_worker: 0, signing_key: KEY,
    props: { account_creation_fee: nai(0, 3, PIXA), maximum_block_size: 262144, pxs_interest_rate: 0, account_subsidy_budget: 797, account_subsidy_decay: 347321 },
    pxs_exchange_rate: { base: nai(0, 3, PIXA), quote: nai(0, 3, PIXA) }, last_pxs_exchange_update: '1970-01-01T00:00:00',
    last_work: '0'.repeat(64), running_version: '0.0.0', hardfork_version_vote: '0.0.0', hardfork_time_vote: GENESIS,
    available_witness_account_subsidies: 0, ...o,
  };
}

export function feed(pxs, pixa) { return { base: `${pxs.toFixed(3)} PXS`, quote: `${pixa.toFixed(3)} PIXA` }; }

export function feedHistory(o = {}) {
  return { id: 0, current_median_history: feed(1, 102), market_median_history: feed(1, 102), current_min_history: feed(1, 102), current_max_history: feed(1, 102), price_history: [], ...o };
}

export function hardfork(o = {}) {
  return { id: 0, processed_hardforks: [GENESIS], last_hardfork: 0, current_hardfork_version: '0.0.0', next_hardfork: '0.0.0', next_hardfork_time: '1970-01-01T00:00:00', ...o };
}

export function version(o = {}) {
  return { blockchain_version: '1.28.7', hive_revision: 'a9df7225da985193157803b3cbc0b6d151fe712b', fc_revision: '1f3833595ff31e6f1396075939bb9f41df9faa48', node_type: 'mainnet', chain_id: '0'.repeat(64), ...o };
}

export function config(o = {}) {
  return {
    HIVE_BLOCK_INTERVAL: 3, HIVE_MAX_WITNESSES: 21, HIVE_WITNESS_SHUTDOWN_THRESHOLD: 28800, HIVE_MAX_FEED_AGE_SECONDS: 604800,
    HIVE_FEED_INTERVAL_BLOCKS: 1200, HIVE_MIN_FEEDS: 7, HIVE_HARDFORK_REQUIRED_WITNESSES: 17, HIVE_ADDRESS_PREFIX: 'PIX', HIVE_GENESIS_TIME: GENESIS,
    HIVE_SYMBOL: 'PIXA', HBD_SYMBOL: 'PXS', VESTS_SYMBOL: 'VESTS', HIVE_BLOCKCHAIN_VERSION: '1.28.7', HIVE_BLOCKCHAIN_HARDFORK_VERSION: '1.28.0',
    HIVE_MAX_BLOCK_SIZE: 2097152, HIVE_IRREVERSIBLE_THRESHOLD: 7500, ...o,
  };
}

export function account(name, o = {}) {
  return {
    name, balance: '0.000 PIXA', pxs_balance: '0.000 PXS', vesting_shares: '0.000000 VESTS', delegated_vesting_shares: '0.000000 VESTS',
    received_vesting_shares: '0.000000 VESTS', proxied_vsf_votes: [0, 0, 0, 0], witnesses_voted_for: 0, witness_votes: [], proxy: '',
    created: GENESIS, last_owner_update: '1970-01-01T00:00:00', ...o,
  };
}

export const blockId = (n) => n.toString(16).padStart(8, '0') + '0'.repeat(32);
export const blockTime = (n) => new Date(Date.parse(GENESIS + 'Z') + n * 3000).toISOString().slice(0, 19);
const byOwner = (a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0);
const byVote = (a, b) => (a.witness < b.witness ? -1 : a.witness > b.witness ? 1 : a.account < b.account ? -1 : a.account > b.account ? 1 : 0);

// Handler map for fakeNode(). Override any piece via `o`.
export function handlers(o = {}) {
  const witnesses = o.witnesses ?? [witness('initminer')];
  const producers = o.producers ?? ['initminer'];
  const votes = [...(o.votes ?? [])].sort(byVote);
  return {
    'condenser_api.get_dynamic_global_properties': () => dgp(o.dgp),
    'database_api.get_witness_schedule': () => schedule(o.schedule),
    'database_api.list_witnesses': ({ start, limit }) => ({ witnesses: witnesses.filter((w) => w.owner >= start).sort(byOwner).slice(0, limit) }),
    'condenser_api.get_witness_count': () => witnesses.length,
    'condenser_api.get_feed_history': () => feedHistory(o.feedHistory),
    'database_api.get_hardfork_properties': () => hardfork(o.hardfork),
    'condenser_api.get_version': () => version(o.version),
    'condenser_api.get_config': () => config(o.config),
    'condenser_api.get_accounts': ([names]) => names.filter((n) => !(o.missingAccounts ?? []).includes(n)).map((n) => o.accounts?.[n] ?? account(n)),
    'database_api.list_witness_votes': ({ start, limit }) => ({
      votes: votes.filter((v) => v.witness > start[0] || (v.witness === start[0] && v.account >= start[1])).slice(0, limit),
    }),
    'block_api.get_block_range': ({ starting_block_num, count }) => ({
      blocks: Array.from({ length: count }, (_, i) => starting_block_num + i).map((n) => ({
        block_id: blockId(n), timestamp: blockTime(n), witness: producers[n % producers.length], transactions: o.txs?.[n] ?? [],
      })),
    }),
    ...(o.handlers ?? {}),
  };
}

// A raw snapshot as returned by fetchSnapshot(), for derive() tests.
export function raw(o = {}) {
  const witnesses = o.witnesses ?? [witness('initminer')];
  const defaultAccounts = Object.fromEntries(witnesses.map((w) => [w.owner, account(w.owner)]));
  return {
    node: 'https://node.test',
    config: { ...DEFAULT_CONFIG, genesisTime: GENESIS, ...(o.config ?? {}) },
    core: {
      dgp: dgp(o.dgp), schedule: schedule(o.schedule), witnesses, witnessCount: witnesses.length, feedHistory: feedHistory(o.feedHistory),
      hardfork: hardfork(o.hardfork), version: version(o.version), latencyMs: 100, fetchedAt: o.fetchedAt ?? 0,
    },
    extras: {
      accounts: o.accounts === undefined ? defaultAccounts : o.accounts,
      votes: o.votes === undefined ? {} : o.votes,
      votesTruncated: o.votesTruncated ?? false, errors: [],
    },
    blocks: o.blocks ?? [],
    errors: o.errors ?? [],
  };
}
