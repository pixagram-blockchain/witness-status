# Pixagram witness status — rules for bots and AI agents

This document explains how to obtain the same aggregated view of the Pixagram network and
its witnesses that the dashboard at <https://pixagram.com/witness-status/> shows, without a
browser. Everything below is derived from public JSON-RPC calls against
`https://api.pixagram.com`; nothing is hidden behind an API key.

Pixagram is a fork of Hive (hived 1.28.7). If you already know the Hive witness APIs, only the
token names differ: `HIVE → PIXA`, `HBD → PXS`, `hbd_* → pxs_*`, `*_hive → *_pixa`, key prefix `PIX`.

## 0. Pick the cheapest option that fits

| You need | Use |
|---|---|
| One HTTP GET, freshness of ~10 minutes is fine | `https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json` (see §1) |
| Fresh data and you can run Node ≥ 20 | `npx github:pixagram-blockchain/witness-status --format json` (see §2) |
| Fresh data over plain HTTP, no code execution | POST the batch in §3 to `https://api.pixagram.com` and apply §4 and §5 |

## 1. The published snapshot (`status.json`)

A GitHub Actions cron job runs the CLI every 10 minutes and force-pushes the result to the
`data` branch of this repository:

- JSON: `https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json`
- Human text: `https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.txt`

Both URLs allow CORS (`Access-Control-Allow-Origin: *`).

Freshness rules: read `generatedAt` and treat a snapshot older than 30 minutes as stale
(GitHub may delay or skip scheduled runs, and it disables the schedule after 60 days without
repository activity). For sub-minute freshness use §2 or §3.

Shape (`schema: 1`):

```jsonc
{
  "schema": 1,
  "generatedAt": "2026-09-04T12:30:00.000Z",   // when the CLI ran (UTC)
  "node": "https://api.pixagram.com",
  "health": {
    "level": "ok" | "info" | "warn" | "critical",
    "exitCode": 0 | 1 | 2,                       // 0 = ok/info, 1 = warn, 2 = critical
    "network":   [ { "level", "code", "message" } ],
    "witnesses": { "<owner>": [ { "level", "code", "message" } ] }
  },
  "model": {
    "fetchedAt": 1788525000000, "node": "...", "latencyMs": 110,
    "network": {
      "status": "progressing" | "lagging" | "stalled" | "not_started",
      "rate": { "observed", "expected", "ratio", "headDelta", "elapsedSec" } | null,  // vs the previous snapshot
      "headBlock", "headBlockId", "headTime", "headAgeSec", "lib", "libLag", "currentWitness",
      "currentAslot", "missedSlotsTotal", "participationCount", "participationPct",
      "recentSlots": [ true, ... 128 booleans, oldest → newest ],
      "genesisTime", "genesisInSec"
    },
    "chain": { "blockInterval", "maxWitnesses", "shutdownThreshold", "maxFeedAgeSec", "nodeVersion", "nodeRevision",
               "majorityVersion", "hfCurrent", "hfNext", "hfNextTime", "vestingRatio", "totalVests", "totalVestingFundPixa",
               "medianFeed": { "price", "base", "quote" }, "minFeed", "maxFeed", "feedCount",
               "medianProps": { "accountCreationFee", "maxBlockSize", "pxsInterestRate", "subsidyBudget", "subsidyDecay" },
               "supply": { "pixa", "pxs", "virtual" } },
    "schedule": { "shuffled": [ "owner", ... ], "n", "currentIndex", "nextIndex", "nextShuffleBlock", "blocksToShuffle" },
    "counts": { "total", "active", "standby", "disabled", "reported" },
    "witnesses": [ { /* see §4.2; sorted by rank */ } ],
    "blocks": { "window": [ { "num", "timestamp", "witness", "txCount", "gapBefore" } ], "perWitness": { "<owner>": n },
                "txTotal", "missedSlotsInWindow", "spanSec", "first", "last", "windowSize" },
    "errors": [ "partial failures, e.g. get_block_range: ..." ]
  }
}
```

Decision rules for a monitoring bot reading the snapshot:

1. `health.level` is `critical` → page someone. `warn` → investigate. `ok`/`info` → nothing to do.
2. `model.network.status` answers "is the network progressing?" (`progressing` = yes).
3. `health.witnesses["<name>"]` lists that witness' problems by `code` (see §5); an empty array means no findings.
4. `model.errors` non-empty means part of the data (accounts, votes or blocks) is missing for this snapshot.

## 2. The CLI

The repository ships a dependency-free Node CLI that runs the exact pipeline the page uses:

```bash
npx github:pixagram-blockchain/witness-status --format json          # full snapshot document (§1 shape)
npx github:pixagram-blockchain/witness-status --format text          # human summary
npx github:pixagram-blockchain/witness-status --check                # exit 0 ok/info, 1 warn, 2 critical, 3 fetch failure
npx github:pixagram-blockchain/witness-status --previous prev.json   # enables block-rate and missed-block deltas
npx github:pixagram-blockchain/witness-status --node https://other-node --window 1000 --out ./out
```

`--previous` should point at the document produced by the previous run; deltas
(`network.rate`, `witnesses[].missedSincePrev`) are computed against it.

## 3. Raw RPC calls

One JSON-RPC batch returns everything needed for the network and witness views. Copy it as-is:

```bash
curl -s -X POST https://api.pixagram.com -H 'Content-Type: application/json' -d '[
  {"jsonrpc":"2.0","id":1,"method":"condenser_api.get_dynamic_global_properties","params":[]},
  {"jsonrpc":"2.0","id":2,"method":"database_api.get_witness_schedule","params":{}},
  {"jsonrpc":"2.0","id":3,"method":"database_api.list_witnesses","params":{"start":"","limit":1000,"order":"by_name"}},
  {"jsonrpc":"2.0","id":4,"method":"condenser_api.get_witness_count","params":[]},
  {"jsonrpc":"2.0","id":5,"method":"condenser_api.get_feed_history","params":[]},
  {"jsonrpc":"2.0","id":6,"method":"database_api.get_hardfork_properties","params":{}},
  {"jsonrpc":"2.0","id":7,"method":"condenser_api.get_version","params":[]}
]'
```

Optional follow-ups:

| Purpose | Call |
|---|---|
| Chain constants (once) | `condenser_api.get_config` `[]` → `HIVE_BLOCK_INTERVAL` (3), `HIVE_MAX_WITNESSES` (21), `HIVE_WITNESS_SHUTDOWN_THRESHOLD` (28800), `HIVE_MAX_FEED_AGE_SECONDS` (604800), `HIVE_GENESIS_TIME` |
| Witness account balances | `condenser_api.get_accounts` `[["owner1","owner2",...]]` (≤ 100 names per call) |
| Voters per witness | `database_api.list_witness_votes` `{"start":["",""],"limit":1000,"order":"by_witness_account"}`; page with `start: [lastWitness, lastAccount]` (the start entry is included again) |
| Recent blocks | `block_api.get_block_range` `{"starting_block_num": N, "count": ≤1000}` → `blocks[].{block_id, timestamp, witness, transactions}`; block number = first 8 hex chars of `block_id` |
| One witness | `condenser_api.get_witness_by_account` `["owner"]` |

Endpoint facts: JSON-RPC 2.0 over HTTPS POST, batches accepted (500 calls verified),
CORS `*`, typical latency ~100 ms. There is no public testnet RPC (`pixagram.dev` is a website).

Parsing rules:

- Timestamps are UTC without a zone suffix (`2026-09-04T12:00:00`). Append `Z` before parsing.
  `1970-01-01T00:00:00` means "never".
- `condenser_api` returns assets as strings (`"1.000 PIXA"`); `database_api` returns
  `{amount:"1000", precision:3, nai:"@@000000021"}`. NAI map: `@@000000021` PIXA, `@@000000013` PXS, `@@000000037` VESTS.
- Numbers above 2^53 arrive as strings (`recent_slots_filled`, `virtual_*`); use BigInt.

## 4. Field semantics and formulas

### 4.1 Network

| Metric | Formula (dgp = `get_dynamic_global_properties`, sched = `get_witness_schedule`) |
|---|---|
| head block, head time | `dgp.head_block_number`, `dgp.time` |
| head age (s) | `now − parse(dgp.time)` (client clock; keep it NTP-synced) |
| LIB, LIB lag | `dgp.last_irreversible_block_num`, `head − LIB` |
| current producer | `dgp.current_witness` |
| missed slots, all time | `dgp.current_aslot − dgp.head_block_number` |
| participation % | `dgp.participation_count / 128 × 100` (`recent_slots_filled` is the 128-bit mask; bit 0 = newest slot) |
| block rate ratio | `((head − prevHead) / elapsedSec) ÷ (1 / HIVE_BLOCK_INTERVAL)` using your previous sample |
| **network status** | `not_started` if head = 0; else `stalled` if head age > 60 s or (elapsed ≥ 15 s and head unchanged); else `lagging` if head age > 3 × block interval (9 s) or (elapsed ≥ 30 s and ratio < 0.8); else `progressing` |
| scheduled witnesses | `sched.num_scheduled_witnesses`; the round is `sched.current_shuffled_witnesses` with empty strings removed |
| current / next slot | `shuffled[current_aslot mod n]`, `shuffled[(current_aslot + 1) mod n]` |
| median feed (PIXA per PXS) | `feed_history.current_median_history.quote ÷ base` (e.g. 102.000 PIXA / 1.000 PXS = 102) |
| VESTS : PIXA | `dgp.total_vesting_fund_pixa ÷ dgp.total_vesting_shares` (1.0 at genesis; stays ~flat by design) |
| majority version | `sched.majority_version` |
| counts | total = list length; active = in the shuffled round; disabled = null signing key; standby = the rest |

### 4.2 Per witness (w = entry of `list_witnesses`)

| Field | Formula |
|---|---|
| rank | position when sorted by `w.votes` descending, then owner ascending |
| disabled | `w.signing_key` is the null key: prefix `PIX` followed by 33 `1` characters (`PIX1111111111111111111111111111111114T1Anm`). Robust test: `/^[A-Za-z]{3}1{30,}/` |
| status | `disabled` → "disabled"; owner in the shuffled round → "active"; else "standby" |
| votes (VESTS) | `w.votes / 1e6` (`votes` is in micro-VESTS) |
| votes (≈ PIXA) | `votesVests × (total_vesting_fund_pixa / total_vesting_shares)` |
| vote share | `w.votes / Σ votes over all witnesses` (accounts may vote for up to 30 witnesses, so shares do not sum to a single stake) |
| total missed | `w.total_missed` (all time; there is no per-period history on chain) |
| missed since previous | `w.total_missed − previous.total_missed` for the same owner |
| last confirmed block, age | `w.last_confirmed_block_num`; `head − last_confirmed_block_num` blocks (× 3 s); 0 = never produced |
| shutdown risk | `head − last_confirmed_block_num > HIVE_WITNESS_SHUTDOWN_THRESHOLD (28800)` and not disabled: the next missed block sets the signing key to the null key (consensus rule) |
| slots since last | `dgp.current_aslot − w.last_aslot` |
| produced in window | count of `get_block_range` blocks with `witness == owner` |
| feed price (PIXA per PXS) | `w.pxs_exchange_rate.quote ÷ base` when both > 0, else no feed |
| feed age | `now − parse(w.last_pxs_exchange_update)`; epoch = never |
| feed deviation % | `(price − medianPrice) / medianPrice × 100` |
| feed stale | no feed, never published, or age > `HIVE_MAX_FEED_AGE_SECONDS` (604800) |
| version behind | `w.running_version` < `sched.majority_version` (compare the three numbers) |
| props | `w.props.account_creation_fee` (PIXA), `maximum_block_size` (bytes), `pxs_interest_rate` (always 0 on Pixagram), `account_subsidy_budget`, `account_subsidy_decay` |
| own stake | `get_accounts[owner].vesting_shares` |
| voters | number of `list_witness_votes` entries with `witness == owner` |

### 4.3 Recent blocks

Consecutive block timestamps normally differ by 3 s. A larger gap means missed slots:
`gapBefore = round(Δt / 3) − 1`. Missed slots cannot be attributed to a witness from block data
alone; use the `total_missed` deltas for that.

## 5. Health thresholds

Network:

| Condition | Level | Code |
|---|---|---|
| status `not_started` | info | `not_started` |
| status `lagging` | warn | `lagging` |
| status `stalled` | critical | `stalled` |
| participation < 90 % | warn | `participation` |
| participation < 66 % | critical | `participation` |
| LIB lag > 30 blocks | warn | `lib_lag` |
| fewer than 3 scheduled witnesses | info | `few_witnesses` |

Witness (rules other than `disabled` are skipped while the chain has not started):

| Condition | Level | Code |
|---|---|---|
| signing key disabled | info | `disabled` |
| missed ≥ 1 block since the previous sample | warn | `missed_recent` |
| blocks since last confirmed > 28800 | critical | `shutdown_risk` |
| active, blocks since last confirmed > 2 × scheduled + 21 | warn | `not_producing` |
| no price feed | warn | `feed_missing` |
| feed older than 7 days | warn | `feed_stale` |
| running version behind the majority | warn | `version_behind` |
| max block size differs from the median | info | `block_size_differs` |

Overall level = the most severe finding. CLI exit codes: 0 ok/info, 1 warn, 2 critical, 3 fetch failure.

## 6. Worked example with curl and jq

```bash
NODE=https://api.pixagram.com
dgp=$(curl -s -X POST $NODE -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"condenser_api.get_dynamic_global_properties","params":[]}')
head=$(echo "$dgp" | jq .result.head_block_number)
age=$(( $(date -u +%s) - $(date -u -d "$(echo "$dgp" | jq -r .result.time)Z" +%s) ))   # GNU date; on macOS use gdate
part=$(echo "$dgp" | jq '.result.participation_count / 128 * 100')
echo "head=$head age=${age}s participation=${part}%"
[ "$head" -eq 0 ] && echo not_started || { [ $age -gt 60 ] && echo stalled || { [ $age -gt 9 ] && echo lagging || echo progressing; }; }

curl -s -X POST $NODE -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"database_api.list_witnesses","params":{"start":"","limit":1000,"order":"by_name"}}' \
  | jq -r '.result.witnesses[] | [.owner, .total_missed, (.votes|tonumber/1e6), .running_version, .signing_key[0:8]] | @tsv'
```

## 7. Caveats

- Head age depends on your clock. If it is off by more than a few seconds you will see false `lagging`/`stalled` results.
- `total_missed` only ever grows; "missed in the last hour" requires two samples taken by you (the CLI's `--previous`, or the browser's local samples).
- `votes` counts approving stake, not the number of voters; a single large account can dominate.
- A witness with `running_version` `0.0.0` has never produced a block since its object was created (the version is stamped by produced blocks).
- Before genesis (head 0) the schedule contains only `initminer`; `hardfork_time_vote` equals the genesis time.
- The dashboard's client-side history lives in the browser's localStorage per node URL; it is not shared.
