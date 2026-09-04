# Pixagram Witness Status — design

Date: 2026-09-04. Status: approved by default (author working autonomously; assumptions listed in §1).

## 1. Goal and assumptions

A public, technical dashboard for Pixagram witnesses: how many exist, their stake
(votes), missed blocks, feeds, versions, schedule position and recent block
production. It auto-refreshes (default 30 s, user-changeable), every metric column
is sortable, and it is hosted on GitHub Pages inside the `pixagram-blockchain`
organisation. Bots must be able to obtain the same aggregated data without a
browser, and AI agents must have written rules for computing it straight from
`https://api.pixagram.com`.

Assumptions made without user confirmation:

1. Repository `pixagram-blockchain/witness-status`, public, Pages served from the
   `main` branch root. Because the org site owns `pixagram.com`, the page URL is
   `https://pixagram.com/witness-status/` (`pixagram-blockchain.github.io/witness-status/` redirects there).
2. Default RPC node is `https://api.pixagram.com` (CORS `*`, JSON-RPC batches of 500
   verified). `pixagram.dev` is a GitHub Pages site, not an RPC node, so there is no
   testnet preset; the UI has a custom node field.
3. No backend. Plain HTML/CSS/JS ES modules, no framework, no build step, no
   runtime dependencies. Node ≥ 20 for tests and the CLI.
4. Trend metrics (missed blocks over 1 h / 24 h) come from samples the browser
   stored while the page was open, or from the previous snapshot when the CLI is
   given one. Nothing else has history on this chain.

## 2. Architecture

```
index.html                 page shell
assets/style.css           dark-first theme, light via prefers-color-scheme
src/lib/                   environment-agnostic modules (browser + Node)
  rpc.js                   JSON-RPC batch client (fetch, timeout, latency, id mapping)
  assets.js                asset string / NAI parsing, BigInt-safe helpers
  chain.js                 fetchSnapshot(node, opts) → raw snapshot
  derive.js                derive(raw, prev?, history?) → aggregated model (pure)
  health.js                rules → statuses/flags (pure)
  format.js                numbers, durations, ages, key truncation (pure)
  columns.js               column definitions + comparators (pure)
  history.js               rolling missed-block samples (pure; storage injected)
src/ui/                    DOM only
  main.js                  boot, settings, refresh loop, wiring
  settings.js              URL params ↔ localStorage ↔ defaults
  render.js                header, stat tiles, schedule, block strip, table, details
bin/witness-status.mjs     CLI: same fetch+derive, JSON/text output, --check exit codes
data/                      (on the `data` branch only) status.json written by cron
AGENT.md                   rules for AI agents / bots (also served at /witness-status/AGENT.md)
llms.txt                   pointer to AGENT.md and the JSON snapshot
test/*.test.js             node --test, covers src/lib
.github/workflows/test.yml CI: node --test on push/PR
.github/workflows/snapshot.yml cron every 10 min: CLI → data/status.json → force-push `data` branch
README.md, package.json, .nojekyll
```

Data flow per refresh: `fetchSnapshot` issues one JSON-RPC batch (core), then
one call for new blocks, then one batch for witness accounts + votes. `derive`
turns the raw snapshot plus the previous derived snapshot (for deltas) and the
missed-block history into the model. `render` is a full re-render of the table
body and panels from the model (rows are cheap; a few dozen witnesses).

## 3. RPC calls

Core batch (every refresh):

| # | method | params | used for |
|---|---|---|---|
| 1 | `condenser_api.get_dynamic_global_properties` | `[]` | head block, time, LIB, current witness, aslot, participation, vesting fund/shares |
| 2 | `database_api.get_witness_schedule` | `{}` | shuffled round, next shuffle block, num scheduled, majority version, median props |
| 3 | `database_api.list_witnesses` | `{start:"", limit:1000, order:"by_name"}` | all witness objects (paginate by last owner if 1000 returned) |
| 4 | `condenser_api.get_witness_count` | `[]` | total count cross-check |
| 5 | `condenser_api.get_feed_history` | `[]` | median / min / max feed, feed count |
| 6 | `database_api.get_hardfork_properties` | `{}` | current / next hardfork |
| 7 | `condenser_api.get_version` | `[]` | node version, revision |

Startup only: `condenser_api.get_config` (block interval, max witnesses, shutdown
threshold, feed max age, address prefix, symbols, genesis time).

Second batch (every refresh): `condenser_api.get_accounts [[owners…]]` in groups
of 100; `database_api.list_witness_votes {start:["",""], limit:1000, order:"by_witness_account"}`
paginated up to 5 pages (counts marked "≥" when truncated).

Blocks: `block_api.get_block_range {starting_block_num, count}` in chunks ≤ 1000
to maintain a rolling window of the last W blocks (default 300, options 100 /
300 / 1000). Only `{num, timestamp, witness, txCount}` is kept per block.

Lazy (on row expand): `database_api.list_witness_votes` for that witness +
`condenser_api.get_accounts` for its voters (≤ 200) to show top voters by
effective stake `vesting_shares + Σ proxied_vsf_votes / 1e6`, labelled as an
approximation (delayed votes are ignored).

Timestamps from hived are UTC without a zone suffix; every parse appends `Z`.
Assets arrive as legacy strings (`"1.000 PIXA"`) from condenser_api and as NAI
objects from database_api; `assets.js` normalises both to `{amount:number, symbol}`
with NAI map `@@000000021→PIXA`, `@@000000013→PXS`, `@@000000037→VESTS`.

## 4. Derived model

### 4.1 Global (`model.network`, `model.chain`)

| field | formula |
|---|---|
| `headBlock`, `headTime`, `lib`, `libLag` | dgp; `libLag = head − last_irreversible_block_num` |
| `headAgeSec` | `now − headTime` (client clock; negative before genesis) |
| `currentAslot`, `missedSlotsTotal` | `current_aslot − head_block_number` |
| `participationPct` | `participation_count / 128 × 100` |
| `recentSlots` | 128 booleans, oldest→newest, from BigInt(`recent_slots_filled`) bit 127…0 (bit 0 = newest) |
| `blockRate` | blocks advanced since previous sample ÷ elapsed seconds; `expected = 1 / block_interval`; `ratio = observed / expected` (null without a previous sample) |
| `status` | `not_started` if head=0; else `stalled` if headAge > 60 s or (`prev` exists, elapsed ≥ 6 s, head unchanged); else `lagging` if headAge > 9 s or ratio < 0.8; else `progressing` |
| `genesisIn` | `genesisTime − now` when `not_started` |
| `vestingRatio` | `total_vesting_fund_pixa / total_vesting_shares` (PIXA per VESTS) |
| `schedule` | `shuffled` (non-empty entries), `n = num_scheduled_witnesses`, `currentIndex = current_aslot mod n`, `nextIndex = (current_aslot+1) mod n`, `nextShuffleBlock`, `blocksToShuffle = nextShuffleBlock − head` |
| counts | `total` (list length), `active` (in shuffled), `standby`, `disabled` |
| feed | median `PIXA per PXS = quote/base`; min, max, `feedCount = price_history.length` |
| versions | `majorityVersion`, `nodeVersion`, `hfCurrent`, `hfNext`, `hfNextTime`, `hardforkRequiredWitnesses` |
| `medianProps` | account creation fee (PIXA), max block size, pxs interest, subsidy budget/decay |
| `latencyMs`, `fetchedAt` | measured around the core batch |

### 4.2 Per witness (`model.witnesses[]`)

| field | formula / source |
|---|---|
| `rank` | 1-based position sorted by `votes` desc, owner asc |
| `disabled` | signing key body (after 3-letter prefix) starts with 30+ `1` characters (null key is `PIX` + 33×`1` + `4T1Anm`) |
| `status` | `disabled` → `"disabled"`; in shuffled round → `"active"`; else `"standby"` |
| `isCurrentProducer` | `owner === dgp.current_witness` |
| `votesVests` | `votes / 1e6` |
| `votesPixa` | `votesVests × vestingRatio` |
| `voteShare` | `votes / Σ votes over all witnesses` (0 when Σ = 0) |
| `voters` | count from list_witness_votes (null if the call failed) |
| `totalMissed` | `total_missed` |
| `missedSinceLoad` | `total_missed − value at first sample this session` |
| `missed1h`, `missed24h` | `total_missed − value at the newest history sample at least 1 h / 24 h old`; if history is shorter, the oldest sample is used and `partial=true`; null when no history |
| `lastConfirmedBlock`, `blocksSinceConfirmed` | `head − last_confirmed_block_num` (null if never produced, i.e. 0) |
| `secondsSinceConfirmed` | `blocksSinceConfirmed × block_interval` |
| `shutdownRisk` | `blocksSinceConfirmed > HIVE_WITNESS_SHUTDOWN_THRESHOLD (28800)` and not disabled: next missed block disables the key |
| `lastAslot`, `slotsSinceLast` | `current_aslot − last_aslot` |
| `producedInWindow`, `windowShare` | count of window blocks with `witness === owner`; ÷ window length |
| `feed.price` | `quote / base` (PIXA per PXS) when both > 0, else null (`none`) |
| `feed.updatedAt`, `feed.ageSec` | `last_pxs_exchange_update`; epoch 1970 ⇒ never |
| `feed.deviationPct` | `(price − medianPrice) / medianPrice × 100` |
| `feed.stale` | `ageSec > HIVE_MAX_FEED_AGE_SECONDS (604800)` or never |
| `version.running`, `version.behind` | `running_version`; behind when semver-less than `majorityVersion` |
| `hfVote` | `hardfork_version_vote` + `hardfork_time_vote` |
| `props` | account creation fee (PIXA), max block size, pxs interest rate, subsidy budget, subsidy decay; `props.maxBlockSizeDiffers` vs median |
| `signingKey`, `url`, `created`, `id` | raw |
| `virtual` | `virtual_last_update`, `virtual_position`, `virtual_scheduled_time` (strings, shown raw) |
| `availableSubsidies` | `available_witness_account_subsidies` |
| `account` | from get_accounts: `vests`, `pixa`, `pxs`, `delegatedVests`, `receivedVests`, `witnessesVotedFor`, `proxy`, `created` (null if missing) |
| `flags[]` | health flags, see §5 |

### 4.3 Blocks (`model.blocks`)

`window` (array of `{num, timestamp, witness, txCount, gapBefore}` where
`gapBefore = (timestamp − prevTimestamp)/block_interval − 1` missed slots before this
block), `perWitness` counts, `txTotal`, `missedSlotsInWindow = Σ gapBefore`, `span`
seconds.

## 5. Health rules (`health.js`)

Network:

| condition | level |
|---|---|
| status `not_started` | info |
| status `lagging` | warn |
| status `stalled` | critical |
| participation < 90 % | warn; < 66 % critical |
| `libLag` > 30 blocks | warn |
| scheduled witnesses < 3 | info (chain running on a handful of producers) |

Witness:

| condition | level |
|---|---|
| disabled | info (excluded from other checks) |
| `missedSinceLoad` > 0 (UI) / missed since previous snapshot > 0 (CLI) | warn |
| `shutdownRisk` | critical |
| active witness with `blocksSinceConfirmed` > 2 × schedule length + 21 | warn |
| feed none or stale | warn (active/standby only) |
| version behind majority | warn |
| max block size differs from median | info |

Overall level = max over all rules; CLI exit code 0 = ok/info, 1 = warn, 2 = critical, 3 = fetch failure.

## 6. UI

Layout, top to bottom:

1. Header: title, node input (default mainnet), interval control (select 5/10/15/30/60/120/300 s + custom number; 0 = paused), countdown "next in Ns", refresh-now button, status pill (OK n ms / ERROR message / STALE if the last fetch failed but old data is shown).
2. Network banner: PROGRESSING / LAGGING / STALLED / NOT STARTED with head block, head age, observed rate vs expected, and the 128-slot participation strip.
3. Stat tiles: head/LIB/lag, current producer, witnesses (total/active/standby/disabled), scheduled n/21, missed slots all-time, median feed + feed count + min/max, majority version + HF, vesting ratio + median props, node version/revision, RPC latency, last refresh.
4. Schedule round: one chip per scheduled slot, current producer highlighted, next producer outlined, "shuffle in N blocks".
5. Recent blocks strip: last W blocks as ticks coloured per witness, gaps drawn for missed slots, hover tooltip with block/time/witness/tx; legend with per-witness counts; window selector.
6. Witness table: filter box, "hide disabled" toggle, column menu (show/hide), sortable headers (click toggles asc/desc, indicator shown, numeric sorts numeric, nulls last, tie-break by name), sticky header and first column, horizontal scroll. Each row expands into a details panel with every raw field, props, feed, HF vote, virtual scheduling values, account balances and top voters (lazy).
7. Footer: methods used, links (repo, witness setup repo, AGENT.md, JSON snapshot), "copy JSON" button that copies the current model.

Default columns: rank, witness, status, votes (M VESTS + share bar), ≈ PIXA, share %, voters, missed total, Δ session, Δ 1h, Δ 24h, produced (window), last block (# + age), feed price, feed age, feed Δ %, version, HF vote, creation fee, max block size, own VESTS, signing key, expand.

Refresh loop: timer restarts after each completed fetch (no overlap); paused when
the tab is hidden and fires immediately on return if overdue; failures keep the
last model on screen and show the error. Settings precedence: URL query
(`node`, `interval`, `sort`, `dir`, `window`, `q`, `hideDisabled`) → localStorage →
defaults; changes update both (history.replaceState).

Theme: dark by default (matches pixagram.com), light palette via
`prefers-color-scheme`. System fonts; tabular numerals; 12–13 px table.

## 7. Bot / agent access

1. **CLI** `bin/witness-status.mjs [--node URL] [--window N] [--previous file] [--format json|text] [--check]`.
   Runs the identical `fetchSnapshot` + `derive` + `health`. `--previous` enables
   deltas (block rate, missed since previous). `--check` prints the text report and
   exits 0/1/2/3 as in §5. Runnable with `npx github:pixagram-blockchain/witness-status`.
2. **Published snapshot**: `.github/workflows/snapshot.yml` runs every 10 minutes and
   on dispatch, downloads the previous `data/status.json` from the `data` branch,
   runs the CLI with `--previous`, and force-pushes an orphan commit to `data`.
   URL: `https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json`.
   Caveat documented: 10-minute cadence, GitHub may delay cron runs, and GitHub
   disables scheduled workflows after 60 days without repository activity.
3. **AGENT.md**: endpoint, exact copy-paste batch request, field semantics,
   every formula from §4, thresholds from §5, snapshot JSON schema, and a curl
   walkthrough. `llms.txt` points to it.

## 8. Error handling

- HTTP failure / timeout (15 s) / malformed JSON → snapshot fails; UI shows error, keeps old data marked stale; CLI exits 3.
- Individual JSON-RPC errors inside the core batch → snapshot fails (all core fields are required).
- Accounts, votes or blocks failing → model fields become null, a warning is shown, everything else renders.
- `head_block_number = 0` → `not_started`, no block fetch, schedule rendered as-is.
- Custom node without CORS → error message suggests a CORS-enabled node.

## 9. Testing

- `node --test` over `src/lib`: asset parsing (legacy, NAI, zero), UTC timestamp parsing, null-key detection, vote conversions, status derivation, feed price/age/deviation/stale, version comparison, recent-slot bitmask decoding, network status, block window gap computation, history deltas and partial flag, column comparators (numeric, string, nulls last, direction), health rules and exit codes, settings parsing.
- `scripts/smoke.mjs`: runs fetch+derive against the live node and prints a summary (used manually and by CI as a non-blocking job).
- Manual: local `python3 -m http.server`, headless Chrome screenshot, check console errors, verify current-producer highlight matches `current_witness` once blocks flow.
