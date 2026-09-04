// Settings precedence: URL query → localStorage → defaults. Every value is validated.
import { DEFAULT_NODE } from '../lib/chain.js';
import { COLUMNS } from '../lib/columns.js';

export const WINDOWS = [100, 300, 1000];
export const INTERVALS = [5, 10, 15, 30, 60, 120, 300];
export const DEFAULTS = { node: DEFAULT_NODE, interval: 30, sort: 'rank', dir: 'asc', window: 300, q: '', hideDisabled: false };
export const STORAGE_KEY = 'witness-status:settings';

export function readSettings(search, storage) {
  const params = new URLSearchParams(search ?? '');
  let stored = {};
  try {
    stored = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    stored = {};
  }
  const pick = (k) => (params.has(k) ? params.get(k) : stored[k] !== undefined ? stored[k] : DEFAULTS[k]);
  const s = { ...DEFAULTS };
  const node = String(pick('node') ?? '').trim();
  if (/^https?:\/\/\S+$/.test(node)) s.node = node;
  const interval = Number(pick('interval'));
  if (Number.isInteger(interval) && interval >= 0 && interval <= 3600) s.interval = interval;
  const sort = pick('sort');
  if (COLUMNS.some((c) => c.key === sort)) s.sort = sort;
  const dir = pick('dir');
  if (dir === 'asc' || dir === 'desc') s.dir = dir;
  const window = Number(pick('window'));
  if (WINDOWS.includes(window)) s.window = window;
  const q = pick('q');
  if (typeof q === 'string') s.q = q.trim().toLowerCase().slice(0, 64);
  const hd = pick('hideDisabled');
  s.hideDisabled = hd === true || hd === '1' || hd === 'true';
  return s;
}

export function settingsToQuery(s) {
  const p = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) {
    if (s[k] === DEFAULTS[k] || s[k] === '' || s[k] === false || s[k] == null) continue;
    p.set(k, k === 'hideDisabled' ? '1' : String(s[k]));
  }
  return p;
}

export function writeSettings(s, storage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode, quota) — settings live in the URL instead */
  }
}
