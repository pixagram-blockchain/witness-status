// Health rules over the derived model. Shared by the UI (flags) and the CLI (exit codes).
// Thresholds are documented in AGENT.md; change them here and there together.

const ORDER = { ok: 0, info: 1, warn: 2, critical: 3 };

export function evaluate(model) {
  const network = [];
  const witnesses = {};
  const flag = (arr, level, code, message) => arr.push({ level, code, message });
  const net = model.network;
  const n = model.schedule?.n ?? 0;
  const started = net.status !== 'not_started';

  if (!started) {
    flag(network, 'info', 'not_started', net.genesisInSec != null ? `chain has not started; genesis in ${Math.round(net.genesisInSec)} s` : 'chain has not started');
  }
  if (net.status === 'lagging') {
    const rate = net.rate ? ` (${(net.rate.ratio * 100).toFixed(0)} % of the expected block rate)` : '';
    flag(network, 'warn', 'lagging', `head block is ${Math.round(net.headAgeSec)} s old${rate}`);
  }
  if (net.status === 'stalled') flag(network, 'critical', 'stalled', `no new blocks: head block is ${Math.round(net.headAgeSec)} s old`);
  if (started) {
    if (net.participationPct < 66) flag(network, 'critical', 'participation', `participation ${net.participationPct.toFixed(1)} % of the last 128 slots`);
    else if (net.participationPct < 90) flag(network, 'warn', 'participation', `participation ${net.participationPct.toFixed(1)} % of the last 128 slots`);
    if (net.libLag > 30) flag(network, 'warn', 'lib_lag', `last irreversible block is ${net.libLag} blocks behind head`);
    if (n < 3) flag(network, 'info', 'few_witnesses', `only ${n} witness(es) scheduled to produce`);
  }

  for (const w of model.witnesses) {
    const f = (witnesses[w.owner] = []);
    if (w.disabled || w.status === 'disabled') {
      flag(f, 'info', 'disabled', 'signing key disabled (null key)');
      continue;
    }
    if (!started) continue;
    if (w.missedSincePrev > 0) flag(f, 'warn', 'missed_recent', `missed ${w.missedSincePrev} block(s) since the previous sample`);
    if (w.shutdownRisk) {
      flag(f, 'critical', 'shutdown_risk', `no block confirmed for ${w.blocksSinceConfirmed} blocks; the next missed block disables this witness`);
    } else if (w.status === 'active' && w.blocksSinceConfirmed != null && w.blocksSinceConfirmed > 2 * n + 21) {
      flag(f, 'warn', 'not_producing', `scheduled but the last produced block was ${w.blocksSinceConfirmed} blocks ago`);
    }
    if (w.feed.price == null) flag(f, 'warn', 'feed_missing', 'no price feed published');
    else if (w.feed.stale) flag(f, 'warn', 'feed_stale', 'price feed is older than the maximum feed age');
    if (w.version.behind) flag(f, 'warn', 'version_behind', `running ${w.version.running}, behind the majority version`);
    if (w.props.maxBlockSizeDiffers) flag(f, 'info', 'block_size_differs', `proposes a max block size of ${w.props.maxBlockSize} bytes, different from the median`);
  }

  const all = [...network, ...Object.values(witnesses).flat()];
  const level = all.reduce((m, x) => (ORDER[x.level] > ORDER[m] ? x.level : m), 'ok');
  return { level, exitCode: level === 'critical' ? 2 : level === 'warn' ? 1 : 0, network, witnesses };
}
