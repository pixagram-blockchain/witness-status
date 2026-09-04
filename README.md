# Pixagram Witness Status

Live, technical status page for the witnesses (block producers) of the [Pixagram](https://pixagram.com) blockchain, a Hive fork.

**Page:** <https://pixagram.com/witness-status/> · **Bot data:** [`status.json`](https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json) · **Rules for agents:** [AGENT.md](AGENT.md)

Everything is computed in the browser straight from the public JSON-RPC node
(`https://api.pixagram.com`, CORS-enabled). No backend, no build step, no dependencies.

## What it shows

- **Network verdict**: PROGRESSING / LAGGING / STALLED / NOT STARTED from head-block age and the observed block rate, with the last 128 slots (participation) drawn as a strip.
- **Chain tiles**: head and irreversible block, witness counts, scheduled slots, missed slots all time, median price feed, majority version and hardfork, VESTS:PIXA ratio, median witness props, supply, RPC latency.
- **Schedule**: the current shuffled round with the producing and next slots highlighted.
- **Recent blocks**: the last 100/300/1000 blocks coloured by producer, gaps for missed slots, transaction counts, per-producer legend.
- **Witness table** (every column sortable): rank, status (active/standby/disabled), votes in VESTS and ≈ PIXA, vote share, voters, missed blocks (all time, this session, last 1 h, last 24 h), blocks produced in the window, last block and its age, price feed with age and deviation from the median, running version, hardfork vote, proposed account creation fee and max block size, own stake, signing key.
- **Per-witness details** (click a row): every raw field, virtual scheduling state, account balances, top voters by effective stake, and health flags.
- **Health flags** on the network and each witness (see [AGENT.md §5](AGENT.md#5-health-thresholds)).

## Controls and URL parameters

| Setting | Control | URL parameter | Default |
|---|---|---|---|
| Refresh interval (seconds, 0 = paused) | "Refresh" select or custom number | `interval=30` | 30 |
| RPC node | "Node" field (Enter to apply) | `node=https://api.pixagram.com` | mainnet |
| Sort | click a column header (again to flip) | `sort=totalMissed&dir=desc` | rank asc |
| Recent-blocks window | "Window" select | `window=300` | 300 |
| Name filter / hide disabled | toolbar | `q=init`, `hideDisabled=1` | – |

Settings persist in the URL (shareable) and in localStorage. Column visibility is in the "columns" menu.
Relative ages tick every second; the page pauses while the tab is hidden and refreshes on return.

## For bots and AI agents

Three ways to get the same aggregated data without a browser, documented in [AGENT.md](AGENT.md):

1. **Published snapshot** (HTTP GET, ~10-minute freshness): `https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json` (and `status.txt`), written to the `data` branch by [`snapshot.yml`](.github/workflows/snapshot.yml).
2. **CLI** (fresh, Node ≥ 20, no dependencies):
   ```bash
   npx github:pixagram-blockchain/witness-status --format text
   npx github:pixagram-blockchain/witness-status --check      # exit 0 ok, 1 warn, 2 critical, 3 fetch failed
   npx github:pixagram-blockchain/witness-status --previous prev.json --format json > status.json
   ```
3. **Raw RPC** with the exact batch request, field semantics, formulas and thresholds in AGENT.md.

## Development

```bash
npm test            # unit tests (node --test), no dependencies
npm run serve       # http://localhost:8000
npm run smoke       # fetch + derive against the live node, print the text report
node scripts/e2e.mjs http://127.0.0.1:8000/ --shot=shot.png   # headless-Chrome interaction checks (needs Chrome)
```

Layout: `src/lib/` is environment-agnostic (RPC client → raw snapshot → pure `derive` → pure `health`) and shared by the page (`src/ui/`), the CLI (`bin/`) and the cron workflow; `test/` covers `src/lib` and the settings parser.
Design notes live in `docs/superpowers/`.

## Deployment

GitHub Pages serves the `main` branch root (`.nojekyll` keeps files as-is). Because the organisation site owns `pixagram.com`, the project is reachable at `https://pixagram.com/witness-status/`.
The snapshot workflow needs the default branch to stay active: GitHub disables cron workflows after 60 days without pushes.

## License

MIT
