# Pixagram Witness Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static GitHub Pages dashboard plus a Node CLI that show, sort and monitor every Pixagram witness metric obtainable from `https://api.pixagram.com`, refreshing every 30 s by default.

**Architecture:** Environment-agnostic ES modules in `src/lib` (RPC batch client → raw snapshot → pure `derive` → pure `health`) are shared by the browser UI (`src/ui`), the CLI (`bin/`) and a cron workflow that publishes an aggregated JSON snapshot to a `data` branch. No framework, no bundler, no runtime dependencies.

**Tech Stack:** HTML/CSS/vanilla JS (ES2022 modules), Node ≥ 20 (`node --test`, global `fetch`), GitHub Pages (branch `main`, root), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-witness-status-design.md`

## Global Constraints

- Default node `https://api.pixagram.com`; JSON-RPC batches ≤ 500 calls; `block_api.get_block_range` count ≤ 1000.
- hived timestamps are UTC without zone suffix: always parse via `parseUtc` (appends `Z`).
- Witness `votes` are micro-VESTS (÷ 1e6 → VESTS); `≈ PIXA = VESTS × total_vesting_fund_pixa / total_vesting_shares`.
- Null signing key: 3-letter prefix followed by 33 `1`s (`PIX1111111111111111111111111111111114T1Anm`); detect with `/^[A-Za-z]{3}1{30,}/`.
- Thresholds (spec §5): lagging head age > 9 s or rate ratio < 0.8 over ≥ 30 s; stalled head age > 60 s or zero blocks over ≥ 15 s; participation warn < 90 %, critical < 66 %; LIB lag warn > 30; shutdown risk when blocks since last confirmed > 28800; feed stale > 604800 s; CLI exit codes 0 ok/info, 1 warn, 2 critical, 3 fetch failure.
- Colours: dataviz reference palette (dark categorical `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`, light `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #4a3aa7 #e34948`, "Other" `#898781`; status good `#0ca30c`, warning `#fab219`, serious `#ec835a`, critical `#d03b3b`; surfaces dark `#0d0d0d`/`#1a1a19`, light `#f9f9f7`/`#fcfcfb`). Status colours always ship with an icon + label.
- Tests: `node --test` (package.json `"test": "node --test test/"`). Every lib function has a test that was seen failing first.
- Commits after every task; no secrets in the repo.

---

## File structure

| Path | Responsibility |
|---|---|
| `package.json`, `.nojekyll`, `.gitignore` | scaffold (`"type":"module"`, `bin`, `scripts.test`) |
| `src/lib/assets.js` | `parseAsset`, `parseUtc`, `isEpoch`, `NAI` |
| `src/lib/rpc.js` | `RpcError`, `rpcBatch`, `rpcCall` |
| `src/lib/chain.js` | `DEFAULT_NODE`, `DEFAULT_CONFIG`, `fetchConfig`, `fetchCore`, `fetchExtras`, `fetchBlocks`, `fetchSnapshot`, `fetchVoters`, `blockNumFromId` |
| `src/lib/derive.js` | `isNullKey`, `decodeRecentSlots`, `compareVersions`, `networkStatus`, `blockWindowStats`, `derive` |
| `src/lib/history.js` | `addSample`, `deltaSince`, `RETENTION_SEC` |
| `src/lib/health.js` | `evaluate` |
| `src/lib/format.js` | `fmtInt`, `fmtNum`, `fmtCompact`, `fmtPct`, `fmtDuration`, `fmtAge`, `fmtBytes`, `shortKey`, `fmtTime` |
| `src/lib/columns.js` | `COLUMNS`, `sortRows`, `STATUS_ORDER` |
| `src/lib/report.js` | `parseArgs`, `textReport`, `snapshotDocument`, `USAGE` |
| `bin/witness-status.mjs` | CLI entry |
| `scripts/smoke.mjs` | live fetch + derive summary |
| `src/ui/settings.js` | `DEFAULTS`, `readSettings`, `settingsToQuery`, `WINDOWS` |
| `src/ui/render.js` | DOM rendering functions |
| `src/ui/main.js` | state, refresh loop, events |
| `index.html`, `assets/style.css` | page |
| `AGENT.md`, `llms.txt`, `README.md` | docs |
| `.github/workflows/test.yml`, `.github/workflows/snapshot.yml` | CI + cron snapshot |
| `test/helpers.js`, `test/*.test.js` | tests |

---

### Task 1: Scaffold

**Files:** Create `package.json`, `.nojekyll`, `.github/workflows/test.yml`, `test/.gitkeep`.

- [ ] **Step 1:** Write `package.json`:

```json
{
  "name": "witness-status",
  "version": "0.1.0",
  "description": "Live technical status of Pixagram witnesses",
  "type": "module",
  "private": true,
  "bin": { "witness-status": "bin/witness-status.mjs" },
  "scripts": { "test": "node --test test/", "smoke": "node scripts/smoke.mjs", "serve": "python3 -m http.server 8000" },
  "engines": { "node": ">=20" },
  "license": "MIT"
}
```

- [ ] **Step 2:** `touch .nojekyll` and write `.github/workflows/test.yml`:

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm test
```

- [ ] **Step 3:** Run `npm test` → expected: exits 0 with 0 tests (or "no test files" warning). Commit `chore: scaffold project`.

---

### Task 2: assets.js

**Files:** Create `src/lib/assets.js`, `test/assets.test.js`.
**Produces:** `parseAsset(x) → {amount:number, symbol:string} | null`, `parseUtc(ts) → ms`, `isEpoch(ts) → boolean`, `NAI`, `EPOCH`.

- [ ] **Step 1: failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsset, parseUtc, isEpoch } from '../src/lib/assets.js';

test('parseAsset parses legacy string', () => {
  assert.deepEqual(parseAsset('245098.039 PXS'), { amount: 245098.039, symbol: 'PXS' });
});
test('parseAsset parses NAI object with 3 decimals', () => {
  assert.deepEqual(parseAsset({ amount: '100000000000', precision: 3, nai: '@@000000021' }), { amount: 100000000, symbol: 'PIXA' });
});
test('parseAsset parses VESTS NAI with 6 decimals', () => {
  assert.deepEqual(parseAsset({ amount: '1500000', precision: 6, nai: '@@000000037' }), { amount: 1.5, symbol: 'VESTS' });
});
test('parseAsset returns null for missing input', () => {
  assert.equal(parseAsset(null), null);
  assert.equal(parseAsset(undefined), null);
});
test('parseUtc treats zone-less timestamps as UTC', () => {
  assert.equal(parseUtc('2026-09-04T12:00:00'), Date.UTC(2026, 8, 4, 12, 0, 0));
});
test('parseUtc accepts trailing Z', () => {
  assert.equal(parseUtc('2026-09-04T12:00:00Z'), Date.UTC(2026, 8, 4, 12, 0, 0));
});
test('isEpoch detects the 1970 sentinel', () => {
  assert.equal(isEpoch('1970-01-01T00:00:00'), true);
  assert.equal(isEpoch('2026-09-04T12:00:00'), false);
});
```

- [ ] **Step 2:** `npm test` → FAIL (module not found).
- [ ] **Step 3: implement**

```js
export const NAI = { '@@000000021': 'PIXA', '@@000000013': 'PXS', '@@000000037': 'VESTS' };
export const EPOCH = '1970-01-01T00:00:00';
export function parseAsset(a) {
  if (a == null) return null;
  if (typeof a === 'string') { const [num, symbol] = a.trim().split(/\s+/); return { amount: Number(num), symbol }; }
  return { amount: Number(a.amount) / 10 ** a.precision, symbol: NAI[a.nai] ?? a.nai };
}
export function parseUtc(ts) { if (!ts) return NaN; return Date.parse(ts.endsWith('Z') ? ts : ts + 'Z'); }
export function isEpoch(ts) { return !ts || ts.startsWith('1970-01-01'); }
```

- [ ] **Step 4:** `npm test` → PASS. Commit `feat: asset and timestamp parsing`.

---

### Task 3: rpc.js

**Files:** Create `src/lib/rpc.js`, `test/rpc.test.js`, `test/helpers.js`.
**Produces:** `class RpcError extends Error {kind:'http'|'network'|'timeout'|'parse'|'rpc', status, method}`; `rpcBatch(node, calls:[{method, params}], {timeoutMs=15000, fetchImpl}) → {results:[{result}|{error}], latencyMs}` (results in call order, ids 1..n, always sends a JSON array); `rpcCall(node, method, params, opts) → result` (throws `RpcError` kind `rpc`).

- [ ] **Step 1:** `test/helpers.js` — a fake node that routes by method:

```js
export function fakeNode(handlers, calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const reqs = Array.isArray(body) ? body : [body];
    const out = reqs.map((r) => {
      calls.push({ method: r.method, params: r.params });
      const h = handlers[r.method];
      if (!h) return { jsonrpc: '2.0', id: r.id, error: { code: -32002, message: `Could not find method ${r.method}` } };
      try { return { jsonrpc: '2.0', id: r.id, result: h(r.params) }; }
      catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32003, message: e.message } }; }
    });
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
```

- [ ] **Step 2: failing tests** (`test/rpc.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcBatch, rpcCall, RpcError } from '../src/lib/rpc.js';
import { fakeNode } from './helpers.js';

test('rpcBatch returns results in call order even if the node reorders them', async () => {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(Array.isArray(body));
    return new Response(JSON.stringify(body.map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.method })).reverse()));
  };
  const { results } = await rpcBatch('https://node', [{ method: 'a', params: [] }, { method: 'b', params: {} }], { fetchImpl });
  assert.deepEqual(results.map((r) => r.result), ['a', 'b']);
});
test('rpcBatch surfaces per-call errors without throwing', async () => {
  const { results } = await rpcBatch('https://node', [{ method: 'nope', params: [] }], { fetchImpl: fakeNode({}) });
  assert.match(results[0].error.message, /Could not find method nope/);
});
test('rpcBatch throws RpcError kind=http on non-2xx', async () => {
  const fetchImpl = async () => new Response('bad gateway', { status: 502 });
  await assert.rejects(rpcBatch('https://node', [{ method: 'a', params: [] }], { fetchImpl }), (e) => e instanceof RpcError && e.kind === 'http' && e.status === 502);
});
test('rpcBatch throws RpcError kind=parse on a non-JSON body', async () => {
  const fetchImpl = async () => new Response('<html>405</html>', { status: 200 });
  await assert.rejects(rpcBatch('https://node', [{ method: 'a', params: [] }], { fetchImpl }), (e) => e.kind === 'parse');
});
test('rpcBatch throws RpcError kind=timeout when the request is aborted', async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  await assert.rejects(rpcBatch('https://node', [{ method: 'a', params: [] }], { fetchImpl, timeoutMs: 5 }), (e) => e.kind === 'timeout');
});
test('rpcBatch throws RpcError kind=network when fetch rejects', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(rpcBatch('https://node', [{ method: 'a', params: [] }], { fetchImpl }), (e) => e.kind === 'network');
});
test('rpcBatch measures latency', async () => {
  const { latencyMs } = await rpcBatch('https://node', [{ method: 'a', params: [] }], { fetchImpl: fakeNode({ a: () => 1 }) });
  assert.ok(latencyMs >= 0);
});
test('rpcCall unwraps the single result', async () => {
  assert.equal(await rpcCall('https://node', 'a', [], { fetchImpl: fakeNode({ a: () => 42 }) }), 42);
});
test('rpcCall throws RpcError kind=rpc on a JSON-RPC error', async () => {
  await assert.rejects(rpcCall('https://node', 'nope', [], { fetchImpl: fakeNode({}) }), (e) => e.kind === 'rpc' && e.method === 'nope');
});
```

- [ ] **Step 3:** `npm test` → FAIL (module not found).
- [ ] **Step 4: implement** `src/lib/rpc.js` exactly as specified in Produces; body: build `[{jsonrpc:'2.0', method, params: params ?? [], id: i+1}]`, `AbortController` + `setTimeout(timeoutMs)`, `fetchImpl(node, {method:'POST', headers:{'Content-Type':'application/json'}, body, signal})`, catch → `AbortError` ⇒ kind `timeout`, else `network`; `!res.ok` ⇒ `http`; `JSON.parse` failure ⇒ `parse`; map responses by `id` back to call order; missing id ⇒ `{error:{message:'no response for <method>'}}`.
- [ ] **Step 5:** `npm test` → PASS. Commit `feat: JSON-RPC batch client`.

---

### Task 4: chain.js (raw snapshot)

**Files:** Create `src/lib/chain.js`, `test/chain.test.js`, `test/fixtures.js`.
**Consumes:** `rpcBatch`, `rpcCall`, `RpcError`.
**Produces:**
- `DEFAULT_NODE = 'https://api.pixagram.com'`
- `DEFAULT_CONFIG = { blockInterval: 3, maxWitnesses: 21, shutdownThreshold: 28800, maxFeedAgeSec: 604800, feedIntervalBlocks: 1200, minFeeds: 7, hardforkRequiredWitnesses: 17, addressPrefix: 'PIX', genesisTime: null, symbols: {liquid:'PIXA', stable:'PXS', vests:'VESTS'}, blockchainVersion: null, hardforkVersion: null, maxBlockSize: 2097152, irreversibleThreshold: 7500 }`
- `fetchConfig(node, opts) → config` (same keys, from `condenser_api.get_config`)
- `fetchCore(node, opts) → { dgp, schedule, witnesses, witnessCount, feedHistory, hardfork, version, latencyMs, fetchedAt }` — one batch: dgp, schedule, `database_api.list_witnesses {start:'', limit:1000, order:'by_name'}`, witness count, feed history, hardfork props, version; if the witness page is full, keep paging with `start = last owner` and drop entries `<= last owner`.
- `fetchExtras(node, owners, {maxVotePages=5, ...opts}) → { accounts: {[name]: account} | null, votes: {[witness]: count} | null, votesTruncated, errors: string[] }`
- `blockNumFromId(id) → number` (`parseInt(id.slice(0,8),16)`)
- `fetchBlocks(node, from, to, opts) → [{num, timestamp, witness, txCount}]` (chunks of 1000)
- `fetchSnapshot(node, {window=300, prevBlocks=[], config=null, ...opts}) → { node, config, core, extras, blocks, errors }`
- `fetchVoters(node, owner, {limit=200, ...opts}) → { voters: [{account, vests, proxiedVests, effectiveVests}], total }` sorted by `effectiveVests` desc.

- [ ] **Step 1:** `test/fixtures.js` with realistic responses copied from the live node (block 0 state): `dgp`, `schedule`, `witness('initminer')` factory (accepts overrides), `feedHistory`, `hardfork`, `version`, `config`, `account(name, overrides)`, and `handlers(overrides)` returning the handler map for `fakeNode`. Blocks handler: `'block_api.get_block_range': ({starting_block_num, count}) => ({ blocks: range(...).map(n => ({ block_id: n.toString(16).padStart(8,'0') + '0'.repeat(32), timestamp: iso(genesis + n*3s), witness: witnessFor(n), transactions: [] })) })`.
- [ ] **Step 2: failing tests**

```js
test('fetchCore returns every core object and the witness list', ...)            // asserts dgp.head_block_number, witnesses[0].owner === 'initminer', witnessCount === 1, version.blockchain_version
test('fetchCore pages the witness list when the first page is full', ...)        // pageSize option = 2, 5 fixture witnesses → 5 unique owners, 3 list_witnesses calls
test('fetchCore throws RpcError when a core call fails', ...)                     // handler for get_witness_schedule throws
test('fetchExtras maps accounts by name and counts votes per witness', ...)      // votes: [{witness:'w1',account:'a'},{witness:'w1',account:'b'},{witness:'w2',account:'a'}] → {w1:2,w2:1}
test('fetchExtras marks votes truncated after maxVotePages', ...)                // handler returns 1000 entries always; maxVotePages 2 → votesTruncated true
test('fetchExtras returns accounts=null and an error when get_accounts fails', ...)
test('fetchExtras sends no get_accounts call for an empty owner list', ...)
test('fetchBlocks chunks requests at 1000 and maps block numbers', ...)          // 1..2500 → calls with counts 1000,1000,500; nums 1..2500
test('fetchSnapshot keeps a rolling window and fetches only new blocks', ...)    // head 350, prevBlocks 1..340, window 300 → one get_block_range 341..350; result nums 51..350
test('fetchSnapshot fetches the whole window on first load', ...)                // head 350, no prev → from 51 to 350
test('fetchSnapshot skips blocks when head is 0', ...)
test('fetchSnapshot records block errors without failing', ...)                  // get_block_range throws → blocks [], errors[0] matches /get_block_range/
test('fetchSnapshot uses DEFAULT_CONFIG when get_config fails', ...)
test('fetchVoters returns voters of one witness sorted by effective stake', ...) // votes for 'w1' by a (vests 5, proxied [1e6,0,0,0]) and b (vests 10) → [b(10), a(6)]
```

- [ ] **Step 3:** `npm test` → FAIL. **Step 4:** implement per Produces. `fetchSnapshot` order: config (fallback DEFAULT_CONFIG + error), core, extras (fallback nulls + error), blocks (`from = max(lastKnown+1, head-window+1, 1)`; prev blocks filtered to `num > head-window`). **Step 5:** PASS, commit `feat: raw chain snapshot fetching`.

---

### Task 5: derive.js

**Files:** Create `src/lib/derive.js`, `test/derive.test.js`.
**Consumes:** `parseAsset`, `parseUtc`, `isEpoch`; fixtures.
**Produces:** `isNullKey(key)`, `decodeRecentSlots(str) → boolean[128]` (index 127 = newest), `compareVersions(a,b) → -1|0|1`, `networkStatus({headBlock, headAgeSec, blockInterval, prev, now}) → {status, rate}`, `blockWindowStats(blocks, blockInterval) → {window, perWitness, txTotal, missedSlotsInWindow, spanSec, first, last}`, `derive(raw, {now, prev, history, sessionBase}) → model` with the shape in spec §4 (`fetchedAt, node, latencyMs, network, chain, schedule, counts, witnesses[], blocks, errors`).

- [ ] **Step 1: failing tests** (one behaviour each):

```js
test('isNullKey recognises the PIX null key and rejects real keys')
test('decodeRecentSlots puts the newest slot last and decodes 2^128-1 as all filled')      // '340282366920938463463374607431768211455' → every true; '340282366920938463463374607431768211454' → last false
test('compareVersions orders semantic versions numerically')                              // 1.28.7 > 1.28.10? no: 1.28.10 > 1.28.7
test('networkStatus is not_started at head 0')
test('networkStatus is progressing when head age is small')
test('networkStatus is lagging when head age exceeds 3 block intervals')
test('networkStatus is stalled when head age exceeds 60 s')
test('networkStatus is stalled when no block arrived over 15 s')                          // prev headBlock same, elapsed 20 s
test('networkStatus computes observed rate ratio from the previous sample')               // prev 10 blocks ago, 30 s elapsed → ratio 1
test('networkStatus ignores the ratio when the elapsed time is short')                    // elapsed 5 s, 1 block → still progressing
test('blockWindowStats counts per witness, tx totals and missed gaps')                    // timestamps 0,3,9,12 → gapBefore [0,0,1,0], missed 1
test('derive ranks witnesses by votes then name and computes stake in PIXA')              // votes 2e12 & 1e12 with fund 2:1 ratio
test('derive marks disabled, active and standby status')
test('derive flags the current producer')
test('derive computes feed price, age, deviation and staleness')                          // base 1.000 PXS quote 110 PIXA vs median 102 → +7.84 %
test('derive reports a missing feed when base or quote is zero')
test('derive computes missed deltas from prev, sessionBase and history')
test('derive marks shutdownRisk when blocks since confirmed exceed the threshold')
test('derive reports schedule indices from the current aslot')                            // n=3, aslot 7 → current 1, next 2
test('derive counts voters, maps accounts and tolerates missing extras')
test('derive computes global counts, participation and missed slots total')
test('derive computes genesisInSec before the chain starts')
```

- [ ] **Step 2:** FAIL. **Step 3: implement**. Key code:

```js
export function isNullKey(key) { return typeof key === 'string' && /^[A-Za-z]{3}1{30,}/.test(key); }
export function decodeRecentSlots(str) {
  let v = BigInt(str); const bits = new Array(128);
  for (let i = 127; i >= 0; i--) { bits[i] = (v & 1n) === 1n; v >>= 1n; }
  return bits;
}
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}
export function networkStatus({ headBlock, headAgeSec, blockInterval, prev, now }) {
  if (!headBlock) return { status: 'not_started', rate: null };
  let rate = null;
  if (prev?.network?.headBlock != null && prev.fetchedAt != null) {
    const elapsedSec = (now - prev.fetchedAt) / 1000;
    if (elapsedSec > 0) {
      const headDelta = headBlock - prev.network.headBlock, observed = headDelta / elapsedSec, expected = 1 / blockInterval;
      rate = { observed, expected, ratio: observed / expected, headDelta, elapsedSec };
    }
  }
  let status = 'progressing';
  if (headAgeSec > 60 || (rate && rate.elapsedSec >= 15 && rate.headDelta === 0)) status = 'stalled';
  else if (headAgeSec > 3 * blockInterval || (rate && rate.elapsedSec >= 30 && rate.ratio < 0.8)) status = 'lagging';
  return { status, rate };
}
```

`derive` per-witness (inside `ranked.map((w, i) => …)`):

```js
const votes = Number(w.votes), votesVests = votes / 1e6;
const disabled = isNullKey(w.signing_key);
const status = disabled ? 'disabled' : scheduled.has(w.owner) ? 'active' : 'standby';
const lastConfirmed = w.last_confirmed_block_num;
const blocksSinceConfirmed = lastConfirmed > 0 ? headBlock - lastConfirmed : null;
const base = parseAsset(w.pxs_exchange_rate.base), quote = parseAsset(w.pxs_exchange_rate.quote);
const feedPrice = base.amount > 0 && quote.amount > 0 ? quote.amount / base.amount : null;
const feedNever = isEpoch(w.last_pxs_exchange_update);
const feedAgeSec = feedNever ? null : (now - parseUtc(w.last_pxs_exchange_update)) / 1000;
const feed = { price: feedPrice, base, quote, updatedAt: feedNever ? null : w.last_pxs_exchange_update, ageSec: feedAgeSec,
  deviationPct: feedPrice != null && medianPrice ? (feedPrice - medianPrice) / medianPrice * 100 : null,
  stale: feedPrice == null || feedNever || feedAgeSec > cfg.maxFeedAgeSec };
const acc = extras.accounts?.[w.owner] ?? null;
return { owner: w.owner, id: w.id, rank: i + 1, status, disabled, isCurrentProducer: w.owner === dgp.current_witness,
  votes, votesVests, votesPixa: votesVests * vestingRatio, voteShare: votesTotal ? votes / votesTotal : 0,
  voters: extras.votes ? (extras.votes[w.owner] ?? 0) : null, votersTruncated: extras.votesTruncated,
  totalMissed: w.total_missed,
  missedSincePrev: prevMissed ? w.total_missed - (prevMissed[w.owner] ?? w.total_missed) : null,
  missedSinceLoad: sessionBase ? w.total_missed - (sessionBase[w.owner] ?? w.total_missed) : null,
  missed1h: history ? deltaSince(history, w.owner, w.total_missed, 3600, now) : null,
  missed24h: history ? deltaSince(history, w.owner, w.total_missed, 86400, now) : null,
  lastConfirmedBlock: lastConfirmed || null, blocksSinceConfirmed, secondsSinceConfirmed: blocksSinceConfirmed == null ? null : blocksSinceConfirmed * bi,
  shutdownRisk: !disabled && blocksSinceConfirmed != null && blocksSinceConfirmed > cfg.shutdownThreshold,
  lastAslot: w.last_aslot, slotsSinceLast: w.last_aslot ? currentAslot - w.last_aslot : null,
  producedInWindow: stats.perWitness[w.owner] ?? 0, windowShare: blocks.length ? (stats.perWitness[w.owner] ?? 0) / blocks.length : 0,
  feed, version: { running: w.running_version, behind: compareVersions(w.running_version, majority) < 0 },
  hfVote: { version: w.hardfork_version_vote, time: w.hardfork_time_vote },
  props: { accountCreationFee: parseAsset(w.props.account_creation_fee).amount, maxBlockSize: w.props.maximum_block_size, pxsInterestRate: w.props.pxs_interest_rate,
    subsidyBudget: w.props.account_subsidy_budget, subsidyDecay: w.props.account_subsidy_decay, maxBlockSizeDiffers: w.props.maximum_block_size !== medianProps.maxBlockSize },
  signingKey: w.signing_key, url: w.url, created: isEpoch(w.created) ? null : w.created,
  virtual: { lastUpdate: w.virtual_last_update, position: w.virtual_position, scheduledTime: w.virtual_scheduled_time },
  availableSubsidies: w.available_witness_account_subsidies,
  account: acc && { vests: parseAsset(acc.vesting_shares).amount, delegatedVests: parseAsset(acc.delegated_vesting_shares).amount, receivedVests: parseAsset(acc.received_vesting_shares).amount,
    pixa: parseAsset(acc.balance).amount, pxs: parseAsset(acc.pxs_balance).amount, witnessesVotedFor: acc.witnesses_voted_for, proxy: acc.proxy, created: acc.created } };
```

`deltaSince` is imported from `history.js` (Task 6) — implement Task 6 first if executing out of order.

- [ ] **Step 4:** PASS, commit `feat: derive witness and network model`.

---

### Task 6: history.js

**Files:** Create `src/lib/history.js`, `test/history.test.js`.
**Produces:** `RETENTION_SEC = 90000`; `addSample(samples, {t, missed:{[owner]:n}}) → samples'` (sorted by `t`; keeps everything from the last 600 s; older samples kept only if ≥ 60 s after the previously kept one; drops samples older than `RETENTION_SEC`); `deltaSince(samples, owner, current, windowSec, now) → {delta, partial, sinceT} | null` (uses the newest sample with `t <= now − windowSec`; if none, the oldest sample with `partial: true`; `null` when there are no samples or the sample lacks `owner`).

- [ ] **Step 1: failing tests**

```js
test('addSample appends and keeps order by time')
test('addSample thins samples older than 10 minutes to one per minute')     // 30 samples 10 s apart, all > 10 min old → 5 kept... (compute exact expectation in the test)
test('addSample drops samples older than the retention window')
test('deltaSince uses the newest sample at least windowSec old')
test('deltaSince falls back to the oldest sample and marks partial')
test('deltaSince returns null without samples or without the owner')
```

- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, commit `feat: missed-block history samples`.

---

### Task 7: health.js

**Files:** Create `src/lib/health.js`, `test/health.test.js`.
**Consumes:** model from `derive`.
**Produces:** `evaluate(model) → { level:'ok'|'info'|'warn'|'critical', exitCode:0|1|2, network:[{level, code, message}], witnesses:{[owner]:[{level, code, message}]} }` implementing spec §5 (witness rules other than `disabled` are skipped while `network.status === 'not_started'`).

- [ ] **Step 1: failing tests** — one per rule: not_started→info/0; lagging→warn/1; stalled→critical/2; participation 85→warn, 50→critical; libLag 31→warn; n<3→info; disabled witness→info only; missedSincePrev 1→warn `missed_recent`; shutdownRisk→critical; active not producing (blocksSinceConfirmed > 2n+21)→warn; feed missing→warn; feed stale→warn; version behind→warn; block size differs→info; overall level is the max; witness rules skipped when not_started. Build models with a small `modelWith(overrides)` helper in the test file.
- [ ] **Step 2:** FAIL. **Step 3:** implement (`ORDER = {ok:0, info:1, warn:2, critical:3}`). **Step 4:** PASS, commit `feat: health rules`.

---

### Task 8: format.js

**Files:** Create `src/lib/format.js`, `test/format.test.js`.
**Produces:** `fmtInt(n)` (`'1,234'`, `'–'` for null), `fmtNum(n, digits=3)`, `fmtCompact(n)` (`'1.23M'`, `'12.5K'`, `'950'`), `fmtPct(x, digits=1)` (`'12.3%'`), `fmtDuration(sec)` (`'0s'`, `'12s'`, `'3m 4s'`, `'2h 5m'`, `'3d 2h'`), `fmtAge(sec)` (`'12s ago'` / `'in 3h 0m'`), `fmtBytes(n)` (`'256 KiB'`, `'2 MiB'`), `shortKey(key)` (`'PIX7J9nS…mw7Y'`: first 8 + ellipsis + last 4), `fmtTime(ms)` (`'2026-09-04 12:00:00 UTC'`).

- [ ] **Step 1:** failing tests for each example above. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, commit `feat: formatting helpers`.

---

### Task 9: columns.js

**Files:** Create `src/lib/columns.js`, `test/columns.test.js`.
**Consumes:** `compareVersions`.
**Produces:** `STATUS_ORDER = {active:0, standby:1, disabled:2}`; `COLUMNS: [{key, label, title, type:'num'|'str'|'version', get(w), defaultVisible:boolean, align:'l'|'r'}]` for keys `rank, owner, status, votesVests, votesPixa, voteShare, voters, totalMissed, missedSinceLoad, missed1h, missed24h, producedInWindow, lastConfirmedBlock, feedPrice, feedAgeSec, feedDeviationPct, version, hfVote, accountCreationFee, maxBlockSize, ownVests, signingKey`; `sortRows(rows, key, dir='asc') → rows'` (stable; nulls/NaN last in both directions; ties by `owner` asc; unknown key falls back to `rank`).

- [ ] **Step 1: failing tests**: numeric sort asc/desc; nulls last in both directions; string sort; version sort (`1.28.10` after `1.28.7`); status sorts active→standby→disabled; tie-break by owner; unknown key → rank order; every column's `get` returns a number/string/null for a derived witness fixture.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, commit `feat: sortable column definitions`.

---

### Task 10: report.js, CLI and smoke script

**Files:** Create `src/lib/report.js`, `bin/witness-status.mjs`, `scripts/smoke.mjs`, `test/report.test.js`.
**Consumes:** `fetchSnapshot`, `derive`, `evaluate`, `format`.
**Produces:** `parseArgs(argv) → {node, window, previous, format:'json'|'text', check, out, help}` (accepts `--k v` and `--k=v`; unknown flag → `{error}`), `textReport(model, health) → string`, `snapshotDocument(model, health) → {schema:1, generatedAt, node, health, model}`, `USAGE`.

- [ ] **Step 1: failing tests**: `parseArgs` defaults; `--node=x --window 100 --previous p.json --format text --check --out dir`; unknown flag error; `textReport` contains the network status line, one row per witness with rank/owner/status/missed, and flag codes; `snapshotDocument` has `schema: 1` and an ISO `generatedAt`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; CLI (`#!/usr/bin/env node`): parse args → read `--previous` (`.model`, warn on failure) → `fetchSnapshot(node, {window, prevBlocks: prev?.blocks?.window ?? []})` → `derive(raw, {prev})` → `evaluate` → print JSON or text, or with `--out DIR` write `status.json` + `status.txt` → exit `check ? health.exitCode : 0`; fetch failure → message on stderr, exit 3. `scripts/smoke.mjs`: runs fetch+derive+evaluate against `DEFAULT_NODE` (or `argv[2]`) and prints the text report.
- [ ] **Step 4:** PASS; `chmod +x bin/witness-status.mjs`; run `node bin/witness-status.mjs --format text` against the live node and check the output; commit `feat: CLI and text report`.

---

### Task 11: Web UI

**Files:** Create `index.html`, `assets/style.css`, `src/ui/settings.js`, `src/ui/render.js`, `src/ui/main.js`, `test/settings.test.js`.
**Consumes:** everything in `src/lib`.
**Produces:** `settings.js`: `WINDOWS = [100, 300, 1000]`, `INTERVALS = [5, 10, 15, 30, 60, 120, 300]`, `DEFAULTS = {node: DEFAULT_NODE, interval: 30, sort: 'rank', dir: 'asc', window: 300, q: '', hideDisabled: false}`, `readSettings(searchParams, storage) → settings` (URL > storage key `witness-status:settings` > defaults; interval integer 0–3600 else default; window ∈ WINDOWS else default; dir ∈ asc/desc; sort ∈ column keys), `settingsToQuery(settings) → URLSearchParams` (non-default values only).

- [ ] **Step 1:** failing tests for `readSettings`/`settingsToQuery` (URL wins over storage; invalid values fall back; query omits defaults). **Step 2:** FAIL. **Step 3:** implement settings.js. **Step 4:** PASS. Commit `feat: settings parsing`.
- [ ] **Step 5:** `index.html` — sections with ids `topbar` (title, node input `#node`, interval `<select id="interval">` + `<input id="interval-custom" type="number" min="0" max="3600">`, countdown `#countdown`, button `#refresh`, status pill `#status`), `#network` (banner), `#tiles`, `#schedule`, `#blocks` (window `<select id="window">`), `#witnesses` (toolbar: filter `#q`, checkbox `#hide-disabled`, `<details id="columns">` menu; `<table id="tbl">`), footer with links and `#copy-json`. Script `type="module"` → `src/ui/main.js`.
- [ ] **Step 6:** `assets/style.css` — tokens on `:root` (dark, from Global Constraints), light overrides under `@media (prefers-color-scheme: light)`; `main.busy { opacity: .7 }`; `.tiles` grid of stat tiles (label 11 px uppercase muted, value 22 px proportional figures); `.banner` with status icon + label and colour by status; `.strip` (flex row of `<i>` ticks, 3 px min width, gaps as `.gap` with the critical colour at 60 % opacity); `.tbl` (12.5 px, `tabular-nums`, sticky `thead`, sticky first column, `th[data-sort]` clickable with `.asc/.desc` indicators, `.bar` inline share bars using `--series-1`, `.details` row grid); `.flag` chips (icon + text).
- [ ] **Step 7:** `render.js` — pure DOM-string builders with `esc()`: `renderTopbar(state)`, `renderNetwork(model, health)`, `renderTiles(model)`, `renderSchedule(model)`, `renderBlocks(model, colorOf)`, `renderTable(model, health, view)` where `view = {sort, dir, q, hideDisabled, hiddenColumns, expanded:Set, voters:Map}`, `renderDetails(w, model, voters)`; ages rendered as `<span class="age" data-ts="…">` and refreshed each second by `tickAges(root, now)`.
- [ ] **Step 8:** `main.js` — state `{settings, config, blocks, model, prev, sessionBase, history, health, colors:Map, expanded:Set, voters:Map, hiddenColumns:Set, timer, nextAt, fetching, lastError}`; `refresh()` (guarded against overlap; `fetchSnapshot` → `derive` → `evaluate` → `addSample` + persist `witness-status:history:<node>` → render → `arm()`); `arm()` sets `nextAt` and the timeout (interval 0 = paused); 1 s ticker updates `#countdown`, ages and head age; `visibilitychange` pauses/resumes (refresh immediately when overdue); events: sort header click, row expand click (lazy `fetchVoters`), filter input, hide-disabled, columns menu (persist `witness-status:columns`), interval/select/custom, node input (Enter → reset state and refresh), window select (reset blocks), refresh button, copy JSON; every setting change → `writeSettings` (localStorage + `history.replaceState` with `settingsToQuery`). Colours: `colorOf(owner)` assigns slots 1–8 on first sight (by rank), `other` afterwards; never reassigns.
- [ ] **Step 9: verify** — `python3 -m http.server 8000` (background) then `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --virtual-time-budget=20000 --dump-dom http://localhost:8000/ > /tmp/dom.html` and grep for the head block and `initminer` row; screenshot with `--screenshot=/tmp/shot.png --window-size=1600,1400` and inspect it; also run the dataviz validator on both categorical sets. Fix anything broken. Commit `feat: web UI`.

---

### Task 12: Docs for humans and agents

**Files:** Create `AGENT.md`, `llms.txt`, `README.md`.

- [ ] **Step 1:** `AGENT.md` sections: Purpose; Endpoints (`https://api.pixagram.com`, CORS `*`, batch ≤ 500); Option A — read the published snapshot (`https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json`, schema of `snapshotDocument`, freshness caveat); Option B — run the CLI (`npx github:pixagram-blockchain/witness-status --format json`, exit codes); Option C — compute it yourself: the exact core batch JSON (copy-paste), field semantics table, every formula from spec §4, thresholds from spec §5, a worked `curl | jq` example, caveats (client clock, UTC timestamps without `Z`, `votes` in micro-VESTS, null key, no on-chain history).
- [ ] **Step 2:** `llms.txt` (title, one-line summary, links to AGENT.md, status.json, the page, the repo).
- [ ] **Step 3:** `README.md`: what it is + URL, screenshot placeholder omitted, features, URL parameters, bot access (three options), local dev (`npm test`, `npm run serve`), deployment (Pages from `main`, snapshot workflow, 60-day cron caveat), licence.
- [ ] **Step 4:** Commit `docs: README, AGENT.md, llms.txt`.

---

### Task 13: Snapshot workflow

**Files:** Create `.github/workflows/snapshot.yml`.

- [ ] **Step 1:** Write the workflow: `schedule: '*/10 * * * *'` + `workflow_dispatch`; `permissions: contents: write`; `concurrency: snapshot`; steps: checkout, setup-node 22, `curl -fsSL -o prev.json https://raw.githubusercontent.com/${{ github.repository }}/data/status.json || echo '{}' > prev.json`, `node bin/witness-status.mjs --previous prev.json --out out/data`, then in `out/`: `git init -q -b data`, `git add -A`, commit as `github-actions[bot]`, `git push -f https://x-access-token:${GITHUB_TOKEN}@github.com/${{ github.repository }} data`.
- [ ] **Step 2:** Validate locally: `node bin/witness-status.mjs --previous /dev/null --out /tmp/wsout` (previous read fails → warning, still writes both files). Commit `ci: publish aggregated snapshot every 10 minutes`.

---

### Task 14: Create the repository and deploy

- [ ] **Step 1:** `gh repo create pixagram-blockchain/witness-status --public --description "Live technical status of Pixagram witnesses" --homepage https://pixagram.com/witness-status/ --source . --push`
- [ ] **Step 2:** `gh api -X POST repos/pixagram-blockchain/witness-status/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'`; poll `gh api repos/pixagram-blockchain/witness-status/pages --jq .status` until `built`; `curl -sI https://pixagram.com/witness-status/` → 200.
- [ ] **Step 3:** `gh workflow run snapshot.yml`; wait; `curl -s https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json | head`.
- [ ] **Step 4:** Headless-Chrome check of the live URL (dump DOM, screenshot). Record the URLs in README if anything differs.
