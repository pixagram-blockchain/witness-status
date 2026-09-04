// Display formatting. Every function returns '–' for null/NaN so cells never show "undefined".
const DASH = '–';
const missing = (n) => n == null || Number.isNaN(n);

export function fmtInt(n) {
  return missing(n) ? DASH : Math.round(n).toLocaleString('en-US');
}

export function fmtNum(n, digits = 3) {
  return missing(n) ? DASH : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtCompact(n) {
  if (missing(n)) return DASH;
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return fmtInt(n);
}

export function fmtPct(x, digits = 1) {
  return missing(x) ? DASH : x.toFixed(digits) + '%';
}

export function fmtDuration(sec) {
  if (missing(sec)) return DASH;
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function fmtAge(sec) {
  if (missing(sec)) return DASH;
  return sec < 0 ? `in ${fmtDuration(-sec)}` : `${fmtDuration(sec)} ago`;
}

export function fmtBytes(n) {
  if (missing(n)) return DASH;
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const s = Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 1 : 0);
  return `${s} ${units[i]}`;
}

export function shortKey(key) {
  if (!key) return '';
  return key.length <= 14 ? key : key.slice(0, 8) + '…' + key.slice(-4);
}

export function fmtTime(ms) {
  if (missing(ms)) return DASH;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}
