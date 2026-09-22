// Fetches a raw witness snapshot from a Pixagram (Hive-compatible) JSON-RPC node.
// Everything here is plain data in the node's own shapes; derive.js turns it into metrics.
import { rpcBatch, rpcCall, RpcError } from './rpc.js';
import { parseAsset } from './assets.js';

export const DEFAULT_NODE = 'https://api.pixagram.com';
const PAGE = 1000; // database_api list limit and block_api.get_block_range maximum

// Pixagram's compile-time constants (condenser_api.get_config on api.pixagram.com, hived 1.29.0). They only
// change with a new node build, so the UI uses them directly for the default node instead of waiting for
// get_config, which is the slowest call the node answers. Other nodes are always asked.
export const DEFAULT_CONFIG = {
  blockInterval: 3, maxWitnesses: 21, shutdownThreshold: 28800, maxFeedAgeSec: 604800, feedIntervalBlocks: 1200, minFeeds: 7,
  hardforkRequiredWitnesses: 17, addressPrefix: 'PIX', genesisTime: '2026-09-04T12:00:00', symbols: { liquid: 'PIXA', stable: 'PXS', vests: 'VESTS' },
  blockchainVersion: '1.29.0', hardforkVersion: '1.29.0', maxBlockSize: 2097152, irreversibleThreshold: 7500,
};

export async function fetchConfig(node, opts = {}) {
  const c = await rpcCall(node, 'condenser_api.get_config', [], opts);
  return {
    blockInterval: c.HIVE_BLOCK_INTERVAL, maxWitnesses: c.HIVE_MAX_WITNESSES, shutdownThreshold: c.HIVE_WITNESS_SHUTDOWN_THRESHOLD,
    maxFeedAgeSec: c.HIVE_MAX_FEED_AGE_SECONDS, feedIntervalBlocks: c.HIVE_FEED_INTERVAL_BLOCKS, minFeeds: c.HIVE_MIN_FEEDS,
    hardforkRequiredWitnesses: c.HIVE_HARDFORK_REQUIRED_WITNESSES, addressPrefix: c.HIVE_ADDRESS_PREFIX, genesisTime: c.HIVE_GENESIS_TIME,
    symbols: { liquid: c.HIVE_SYMBOL, stable: c.HBD_SYMBOL, vests: c.VESTS_SYMBOL },
    blockchainVersion: c.HIVE_BLOCKCHAIN_VERSION, hardforkVersion: c.HIVE_BLOCKCHAIN_HARDFORK_VERSION,
    maxBlockSize: c.HIVE_MAX_BLOCK_SIZE, irreversibleThreshold: c.HIVE_IRREVERSIBLE_THRESHOLD,
  };
}

function unwrap(results, calls) {
  return results.map((r, i) => {
    if (r.error) throw new RpcError(`${calls[i].method}: ${r.error.message}`, { kind: 'rpc', method: calls[i].method });
    return r.result;
  });
}

// One batch with everything the dashboard needs every refresh. The witness list is
// paged by owner name if it does not fit in one page (start is inclusive).
export async function fetchCore(node, { pageSize = PAGE, ...opts } = {}) {
  const calls = [
    { method: 'condenser_api.get_dynamic_global_properties', params: [] },
    { method: 'database_api.get_witness_schedule', params: {} },
    { method: 'database_api.list_witnesses', params: { start: '', limit: pageSize, order: 'by_name' } },
    { method: 'condenser_api.get_witness_count', params: [] },
    { method: 'condenser_api.get_feed_history', params: [] },
    { method: 'database_api.get_hardfork_properties', params: {} },
    { method: 'condenser_api.get_version', params: [] },
  ];
  const fetchedAt = Date.now();
  const { results, latencyMs } = await rpcBatch(node, calls, opts);
  const [dgp, schedule, firstPage, witnessCount, feedHistory, hardfork, version] = unwrap(results, calls);
  const witnesses = [...firstPage.witnesses];
  let page = firstPage.witnesses;
  while (page.length >= pageSize) {
    const last = witnesses[witnesses.length - 1].owner;
    page = (await rpcCall(node, 'database_api.list_witnesses', { start: last, limit: pageSize, order: 'by_name' }, opts)).witnesses;
    const fresh = page.filter((w) => w.owner > last);
    if (!fresh.length) break;
    witnesses.push(...fresh);
  }
  return { dgp, schedule, witnesses, witnessCount, feedHistory, hardfork, version, latencyMs, fetchedAt };
}

// Witness accounts (balances, own stake) and the number of voters per witness.
// Failures here degrade to null so the core table still renders.
export async function fetchExtras(node, owners, { maxVotePages = 5, ...opts } = {}) {
  const errors = [];
  const calls = [];
  for (let i = 0; i < owners.length; i += 100) calls.push({ method: 'condenser_api.get_accounts', params: [owners.slice(i, i + 100)] });
  calls.push({ method: 'database_api.list_witness_votes', params: { start: ['', ''], limit: PAGE, order: 'by_witness_account' } });
  const { results } = await rpcBatch(node, calls, opts);
  const voteRes = results.pop();

  let accounts = {};
  for (const r of results) {
    if (r.error) { accounts = null; errors.push(`get_accounts: ${r.error.message}`); break; }
    for (const a of r.result) accounts[a.name] = a;
  }

  let votes = null;
  let votesTruncated = false;
  if (voteRes.error) {
    errors.push(`list_witness_votes: ${voteRes.error.message}`);
  } else {
    const counts = {};
    let page = voteRes.result.votes;
    let full = page.length >= PAGE;
    let pages = 1;
    for (;;) {
      for (const v of page) counts[v.witness] = (counts[v.witness] ?? 0) + 1;
      if (!full) break;
      if (pages >= maxVotePages) { votesTruncated = true; break; }
      const last = page[page.length - 1];
      const raw = (await rpcCall(node, 'database_api.list_witness_votes', { start: [last.witness, last.account], limit: PAGE, order: 'by_witness_account' }, opts)).votes;
      full = raw.length >= PAGE;
      pages++;
      page = raw.filter((v) => !(v.witness === last.witness && v.account === last.account));
    }
    votes = counts;
  }
  return { accounts, votes, votesTruncated, errors };
}

// The first 4 bytes of a block id are the block number.
export function blockNumFromId(id) {
  return parseInt(id.slice(0, 8), 16);
}

export async function fetchBlocks(node, from, to, opts = {}) {
  const out = [];
  for (let start = from; start <= to; start += PAGE) {
    const count = Math.min(PAGE, to - start + 1);
    const { blocks } = await rpcCall(node, 'block_api.get_block_range', { starting_block_num: start, count }, opts);
    for (const b of blocks) out.push({ num: blockNumFromId(b.block_id), id: b.block_id, timestamp: b.timestamp, witness: b.witness, txCount: b.transactions.length });
  }
  return out;
}

const EMPTY_EXTRAS = { accounts: null, votes: null, votesTruncated: false, errors: [] };

// Start config and core together, then extras/blocks as soon as core arrives. Config does
// not gate those requests. onCore paints with the actual config while extras/blocks finish.
// Cached blocks are reused, including when the selected window grows or shrinks.
export async function fetchSnapshot(node, { window = 300, prevBlocks = [], irreversibleBlock = Infinity, blockCache = null, config = null, onCore = null, onUpdate = null, ...opts } = {}) {
  const errors = [];
  const configPromise = config ? Promise.resolve(config) : fetchConfig(node, opts).catch((e) => { errors.push(`get_config: ${e.message}`); return DEFAULT_CONFIG; });
  const core = await fetchCore(node, opts);
  const head = core.dgp.head_block_number;
  const keep = (blocks, limit) => blocks.filter((b) => b.num > head - window && b.num <= Math.min(head, limit));
  const kept = keep(prevBlocks, irreversibleBlock === Infinity ? Infinity : Math.min(irreversibleBlock, core.dgp.last_irreversible_block_num));
  const owners = core.witnesses.map((w) => w.owner);
  const extrasPromise = fetchExtras(node, owners, opts).catch((e) => ({ ...EMPTY_EXTRAS, errors: [`extras: ${e.message}`] }));
  // Fetch only missing contiguous ranges, including the older part of an expanded window.
  const blocksPromise = (async () => {
    let retained = kept;
    const anchor = blockCache?.blocks?.at(-1);
    if (!prevBlocks.length && anchor && blockCache.chainId === core.version.chain_id
      && anchor.num > head - window && anchor.num <= core.dgp.last_irreversible_block_num) {
      try {
        // Validate the anchor and fetch the new/reversible tail in the same round trip.
        const live = await fetchBlocks(node, anchor.num, head, opts);
        if (live[0]?.id === anchor.id) retained = keep(blockCache.blocks, core.dgp.last_irreversible_block_num).concat(live.slice(1));
      } catch { /* Cache validation failure falls back to a fresh window. */ }
    }
    const fresh = [];
    let from = Math.max(head - window + 1, 1);
    for (const b of [...retained, { num: head + 1 }]) {
      if (from < b.num) {
        try { fresh.push(...await fetchBlocks(node, from, b.num - 1, opts)); }
        catch (e) { errors.push(`get_block_range: ${e.message}`); }
      }
      from = b.num + 1;
    }
    return retained.concat(fresh).sort((a, b) => a.num - b.num);
  })();
  const cfg = await configPromise;
  let snapshot = { node, config: cfg, core, extras: EMPTY_EXTRAS, blocks: kept, errors: [...errors] };
  if (onCore) onCore(snapshot);
  onUpdate?.(snapshot, 'core');
  await Promise.all([
    extrasPromise.then((extras) => {
      errors.push(...extras.errors);
      snapshot = { ...snapshot, extras, errors: [...errors] };
      onUpdate?.(snapshot, 'extras');
    }),
    blocksPromise.then((blocks) => {
      snapshot = { ...snapshot, blocks, errors: [...errors] };
      onUpdate?.(snapshot, 'blocks');
    }),
  ]);
  return { ...snapshot, errors: [...errors] };
}

// Voters of one witness with their approximate voting stake (own VESTS + proxied VESTS).
export async function fetchVoters(node, owner, { limit = 200, ...opts } = {}) {
  const { votes } = await rpcCall(node, 'database_api.list_witness_votes', { start: [owner, ''], limit: PAGE, order: 'by_witness_account' }, opts);
  const names = votes.filter((v) => v.witness === owner).map((v) => v.account);
  const chosen = names.slice(0, limit);
  const calls = [];
  for (let i = 0; i < chosen.length; i += 100) calls.push({ method: 'condenser_api.get_accounts', params: [chosen.slice(i, i + 100)] });
  let accounts = [];
  if (calls.length) {
    const { results } = await rpcBatch(node, calls, opts);
    accounts = unwrap(results, calls).flat();
  }
  const voters = accounts.map((a) => {
    const vests = parseAsset(a.vesting_shares).amount;
    const proxiedVests = a.proxied_vsf_votes.reduce((s, x) => s + Number(x), 0) / 1e6;
    return { account: a.name, vests, proxiedVests, effectiveVests: vests + proxiedVests };
  }).sort((a, b) => b.effectiveVests - a.effectiveVests || (a.account < b.account ? -1 : 1));
  return { voters, total: names.length };
}
