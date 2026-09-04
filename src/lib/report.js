// CLI argument parsing and text/JSON reports. No I/O here so it stays testable.
import { DEFAULT_NODE } from './chain.js';
import { fmtInt, fmtNum, fmtPct, fmtDuration, fmtAge, fmtTime } from './format.js';

export const USAGE = `Usage: witness-status [options]

Fetches Pixagram witness data from a JSON-RPC node and prints an aggregated snapshot.

Options:
  --node URL        JSON-RPC endpoint (default ${DEFAULT_NODE})
  --window N        recent-blocks window size, 1-1000 (default 300)
  --previous FILE   previous JSON snapshot; enables block-rate and missed-block deltas
  --format json|text  output format (default json)
  --check           exit with 0 ok/info, 1 warn, 2 critical according to the health rules
  --out DIR         write status.json and status.txt into DIR instead of printing
  --help, -h        show this help

Exit codes: 0 ok, 1 warn (--check), 2 critical (--check), 3 fetch failure, 64 usage error.`;

export function parseArgs(argv) {
  const out = { node: DEFAULT_NODE, window: 300, previous: null, format: 'json', check: false, out: null, help: false, error: null };
  const args = [...argv];
  while (args.length) {
    let a = args.shift();
    let v = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) { v = a.slice(eq + 1); a = a.slice(0, eq); }
    const value = () => {
      if (v == null) v = args.shift();
      if (v == null) out.error = `${a} needs a value`;
      return v;
    };
    switch (a) {
      case '--help': case '-h': out.help = true; break;
      case '--check': out.check = true; break;
      case '--node': out.node = value(); break;
      case '--previous': out.previous = value(); break;
      case '--out': out.out = value(); break;
      case '--window': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1 || n > 1000) out.error = `--window must be an integer between 1 and 1000`;
        else out.window = n;
        break;
      }
      case '--format': {
        const f = value();
        if (f !== 'json' && f !== 'text') out.error = `--format must be json or text`;
        else out.format = f;
        break;
      }
      default: out.error = `unknown option ${a}`;
    }
    if (out.error) break;
  }
  return out;
}

export function snapshotDocument(model, health, now = Date.now()) {
  return { schema: 1, generatedAt: new Date(now).toISOString(), node: model.node, health, model };
}

const STATUS_LABEL = { not_started: 'NOT STARTED', progressing: 'PROGRESSING', lagging: 'LAGGING', stalled: 'STALLED' };
const pad = (s, n, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));

export function textReport(model, health, now = Date.now()) {
  const net = model.network;
  const ch = model.chain;
  const lines = [];
  lines.push(`Pixagram witness status  ${model.node}  ${fmtTime(now)}  (rpc ${model.latencyMs} ms)`);
  const netBits = [STATUS_LABEL[net.status] ?? net.status];
  if (net.status === 'not_started') netBits.push(`genesis ${net.genesisTime} (genesis in ${fmtDuration(net.genesisInSec)})`);
  netBits.push(`head #${fmtInt(net.headBlock)} (${fmtAge(net.headAgeSec)})`, `LIB #${fmtInt(net.lib)} (lag ${net.libLag})`, `producer ${net.currentWitness}`,
    `aslot ${fmtInt(net.currentAslot)} missed-slots ${fmtInt(net.missedSlotsTotal)}`, `participation ${fmtPct(net.participationPct)} (${net.participationCount}/128)`);
  if (net.rate) netBits.push(`rate ${net.rate.observed.toFixed(3)} blk/s (${(net.rate.ratio * 100).toFixed(0)}% of expected, ${net.rate.headDelta} blocks in ${fmtDuration(net.rate.elapsedSec)})`);
  lines.push(`NETWORK  ${netBits.join('  ')}`);
  lines.push(`CHAIN    hived ${ch.nodeVersion}  majority ${ch.majorityVersion}  HF ${ch.hfCurrent}${ch.hfNext && ch.hfNext !== '0.0.0' && ch.hfNext !== ch.hfCurrent ? ` (next ${ch.hfNext}${ch.hfNextTime ? ' at ' + ch.hfNextTime : ''})` : ''}  ` +
    `median feed ${fmtNum(ch.medianFeed.price)} PIXA/PXS (${ch.feedCount} feeds, min ${fmtNum(ch.minFeed)} max ${fmtNum(ch.maxFeed)})  ` +
    `VESTS:PIXA ${fmtNum(ch.vestingRatio, 6)}  scheduled ${model.schedule.n}/${ch.maxWitnesses}  ` +
    `witnesses ${model.counts.total} (${model.counts.active} active, ${model.counts.standby} standby, ${model.counts.disabled} disabled)`);
  const b = model.blocks;
  lines.push(`BLOCKS   window ${b.windowSize}` + (b.windowSize ? ` (#${fmtInt(b.first)}–#${fmtInt(b.last)}, ${fmtDuration(b.spanSec)})  txs ${fmtInt(b.txTotal)}  missed slots in window ${fmtInt(b.missedSlotsInWindow)}` : ''));
  lines.push(`SCHEDULE ${model.schedule.shuffled.map((w, i) => (i === model.schedule.currentIndex ? `[${w}]` : i === model.schedule.nextIndex ? `>${w}` : w)).join(' ')}  (reshuffle every ${ch.maxWitnesses} blocks, next at #${fmtInt(model.schedule.nextShuffleBlock)} in ${model.schedule.blocksToShuffle})`);
  lines.push(`HEALTH   ${health.level.toUpperCase()} (exit ${health.exitCode})`);
  for (const f of health.network) lines.push(`  - [${f.level}] ${f.code}: ${f.message}`);
  if (model.errors.length) lines.push(`ERRORS   ${model.errors.join(' | ')}`);
  lines.push('WITNESSES');
  const head = ['#', 'witness', 'status', 'votes(M)', '≈PIXA', 'share', 'missed', 'Δprev', 'produced', 'last block', 'feed', 'feed age', 'version', 'flags'];
  const rows = model.witnesses.map((w) => [
    w.rank, w.owner + (w.isCurrentProducer ? '*' : ''), w.status, fmtNum(w.votesVests / 1e6, 3), fmtInt(w.votesPixa), fmtPct(w.voteShare * 100),
    fmtInt(w.totalMissed), w.missedSincePrev == null ? '–' : `+${w.missedSincePrev}`, fmtInt(w.producedInWindow),
    w.lastConfirmedBlock ? `#${fmtInt(w.lastConfirmedBlock)} (${fmtDuration(w.secondsSinceConfirmed)} ago)` : 'never',
    w.feed.price == null ? '–' : fmtNum(w.feed.price), w.feed.ageSec == null ? 'never' : fmtDuration(w.feed.ageSec), w.version.running,
    (health.witnesses[w.owner] ?? []).map((f) => f.code).join(',') || '-',
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const right = new Set([0, 3, 4, 5, 6, 7, 8]);
  lines.push('  ' + head.map((h, i) => pad(h, widths[i], right.has(i))).join('  '));
  for (const r of rows) lines.push('  ' + r.map((c, i) => pad(c, widths[i], right.has(i))).join('  '));
  lines.push('  (* = current producer; Δprev = blocks missed since the previous snapshot)');
  return lines.join('\n');
}
