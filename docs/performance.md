# Performance review (2026-09-22)

The dashboard has no runtime dependencies, with the same controls, metrics, refresh intervals,
RPC data sources and CLI output. No live data is cached for longer to obtain these gains.

Changes in this pass:

- Reuse `Intl.NumberFormat` objects instead of constructing locale formatters for each cell.
- Binary-search sorted history for the 1h/24h cutoff instead of scanning it for every witness.
- Start extras and block requests as soon as core data arrives, without waiting for config.
- Retain blocks when switching window size; fetch only the missing ranges and new blocks.
- Sort/filter the witness list once per table render; retain unchanged header nodes.
- Skip unchanged age labels and age/countdown updates while the document is hidden.
- Preserve provisional first paint, but apply verified configuration before completing the
  model, including when refresh is paused. Report configuration failure as a partial error.

## Measurements

Offline Node benchmark on the development machine, compared against a copy of the working
files taken at the start of this pass. That baseline already contained module preloads,
concurrent config/core and extras/blocks requests, early rendering, and config caching.
CPU timings are medians of five batches after warmup; they measure model derivation and
HTML string generation, **not browser layout, paint, or end-to-end page load**.

| Work | Before | After |
|---|---:|---:|
| Generate table HTML, 8 witnesses | 0.6234 ms | 0.0372 ms |
| Generate table HTML, 1,000 witnesses | 79.1248 ms | 4.8227 ms |
| Derive 1,000 witnesses with 25h history | 2.3160 ms | 1.1125 ms |
| Snapshot with controlled RPC delays | 312.2 ms | 201.8 ms |

The RPC test simulates config at 200 ms, core at 50 ms, extras at 100 ms, and blocks at
100 ms. Actual network times vary with the node and connection. The current live chain
had eight witnesses during verification; the 1,000-row case is a scaling test.

Reproduce against any saved checkout:

```sh
node scripts/bench.mjs /path/to/baseline
node scripts/bench.mjs
npm test
npm run smoke
```

The live read-only smoke test returned a complete snapshot with eight witnesses and
100 recent blocks, no partial errors, and health OK. Regression tests cover concurrent
requests, provisional rendering, verified config on a paused page, window growth/shrink,
locale output equivalence, history cutoffs, and avoiding unchanged age-label writes.

Browser checks passed on the local page using the live public RPC: sorting both ways,
filtering and clearing, expanding/collapsing witness details, loading voters, toggling
columns, and changing to 100/1,000-block windows. At 390 px viewport width the document
stayed 390 px wide. Table HTML also matched the starting baseline byte-for-byte for
four sorts with all columns and expanded details.

Re-review of commit `c5814b8` reproduced the configuration issue in two failing tests on
a clean copy of that commit. The pending local fix passes both; the complete working-tree
suite at that point passed 147 tests. The fix is included in this change.


## Independent loading, persistent blocks, and browser bundle

The next pass adds staged snapshot callbacks (`core`, `extras`, `blocks`) on every refresh.
The displayed model can advance while the completed model remains unchanged for history and
JSON export. Sorting/filtering/details operate on the displayed model. Switching nodes clears
old node data immediately and rejects callbacks from superseded node/window selections.

The per-node block cache stores a contiguous suffix of at most 1,000 finalized summaries,
including block IDs, for up to 24 hours. It validates structure and chain ID, then checks the
last cached block against a live range response. That same request fetches the new/reversible
tail. A mismatch or failed validation falls back to a fresh window. In-memory refreshes also
replace the tail above the previously observed irreversible block.

The checked-in esbuild bundle keeps the existing GitHub Pages deployment. Build/check scripts,
a pinned development dependency and lockfile, and a CI freshness check keep source, bundle,
and HTML version in sync. No runtime package or backend is added.

Measured build sizes for the new implementation:

| Browser JavaScript | Separate source modules | Minified bundle |
|---|---:|---:|
| Files | 13 | 1 |
| Uncompressed bytes | 81,065 | 47,101 |
| Local gzip bytes | 29,819 | 17,335 |

Gzip numbers are a local comparison, not a measurement of the hosting provider's encoder.
The bundle is approximately 42% smaller than the equivalent separate modules.

Validation: all 160 tests pass, including both completion orders, immutable stage snapshots,
paused config verification, cache expiry/corruption/storage failure, chain mismatch, changed
anchor, failed validation fallback, reversible-tail replacement, stable colors and node-switch
clearing. `npm run build:check` passes. The bundle ran in the browser with real RPC data and
passed the live CLI smoke test without partial errors.

In a browser fixture with accounts delayed by six seconds, the 300-block strip rendered while
status still read “fetching…” and voters remained unavailable. The fixture logged 300 fetched
blocks on the first visit and only 21 (anchor plus tail) on subsequent reloads: 93% fewer block
objects for that scenario, without an additional anchor round trip.
