// Rolling samples of per-witness total_missed, used for "missed in the last 1 h / 24 h".
// There is no on-chain history for this, so samples come from whoever kept the page open
// (browser localStorage) or from the previous CLI snapshot.

export const RETENTION_SEC = 90000; // 25 h, enough for a 24 h window
const DENSE_MS = 600_000; // keep every sample from the last 10 minutes
const SPARSE_MS = 60_000; // older than that: one sample per minute

// sample: { t: epoch ms, missed: { [owner]: total_missed } }
export function addSample(samples, sample) {
  const all = [...samples, sample].sort((a, b) => a.t - b.t);
  const now = all[all.length - 1].t;
  const out = [];
  let lastKept = -Infinity;
  for (const s of all) {
    if (s.t < now - RETENTION_SEC * 1000) continue;
    if (s.t > now - DENSE_MS || s.t - lastKept >= SPARSE_MS) {
      out.push(s);
      lastKept = s.t;
    }
  }
  return out;
}

// Delta of `current` against the newest sample at least windowSec old. Falls back to the
// oldest sample (partial=true) when history does not reach that far back.
export function deltaSince(samples, owner, current, windowSec, now) {
  if (!samples.length) return null;
  const cutoff = now - windowSec * 1000;
  let pick = null;
  for (const s of samples) {
    if (s.t <= cutoff) pick = s;
    else break;
  }
  const partial = pick == null;
  if (partial) pick = samples[0];
  if (pick.missed[owner] == null) return null;
  return { delta: current - pick.missed[owner], partial, sinceT: pick.t };
}
