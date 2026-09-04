// Browser entry point: state, refresh loop, event wiring. Rendering lives in render.js.
import { fetchSnapshot, fetchVoters } from '../lib/chain.js';
import { derive } from '../lib/derive.js';
import { evaluate } from '../lib/health.js';
import { addSample } from '../lib/history.js';
import { COLUMNS } from '../lib/columns.js';
import { snapshotDocument } from '../lib/report.js';
import { fmtTime } from '../lib/format.js';
import { readSettings, writeSettings, settingsToQuery, INTERVALS, WINDOWS } from './settings.js';
import * as R from './render.js';

const $ = (id) => document.getElementById(id);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const HIST_KEY = (node) => `witness-status:history:${node}`;
const COLS_KEY = 'witness-status:columns';

const state = {
  settings: readSettings(location.search, storage),
  config: null, blocks: [], model: null, prev: null, sessionBase: null, health: null, history: [],
  colors: new Map(), expanded: new Set(), voters: new Map(), hidden: new Set(loadHidden()),
  timer: null, nextAt: null, fetching: false, pending: false, lastError: null,
};

function loadHidden() {
  try {
    const v = JSON.parse(storage?.getItem(COLS_KEY) ?? 'null');
    if (Array.isArray(v)) return v;
  } catch { /* fall through */ }
  return COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.key);
}
function loadHistory(node) {
  try {
    const v = JSON.parse(storage?.getItem(HIST_KEY(node)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveHistory(node, h) { try { storage?.setItem(HIST_KEY(node), JSON.stringify(h)); } catch { /* ignore */ } }
function persistSettings() {
  writeSettings(state.settings, storage);
  const q = settingsToQuery(state.settings).toString();
  history.replaceState(null, '', q ? `?${q}` : location.pathname);
}

// Categorical colour slots are assigned once per witness (by rank on first sight) and never reassigned.
function colorOf(owner) {
  if (!state.colors.has(owner)) {
    const used = new Set(state.colors.values());
    let slot = 'other';
    for (let i = 1; i <= 8; i++) if (!used.has(i)) { slot = i; break; }
    state.colors.set(owner, slot);
  }
  return state.colors.get(owner);
}

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.title = text;
  el.className = `pill ${cls}`;
}

async function refresh() {
  if (state.fetching) { state.pending = true; return; }
  state.fetching = true;
  clearTimeout(state.timer);
  state.timer = null;
  $('main').classList.add('busy');
  setStatus('fetching…', 'busy');
  renderCountdown();
  const node = state.settings.node;
  try {
    const raw = await fetchSnapshot(node, { window: state.settings.window, prevBlocks: state.blocks, config: state.config });
    if (node === state.settings.node) {
      state.config = raw.config;
      state.blocks = raw.blocks;
      if (!state.sessionBase) state.sessionBase = Object.fromEntries(raw.core.witnesses.map((w) => [w.owner, w.total_missed]));
      const model = derive(raw, { prev: state.model, history: state.history, sessionBase: state.sessionBase });
      for (const w of model.witnesses) colorOf(w.owner);
      state.prev = state.model;
      state.model = model;
      state.health = evaluate(model);
      state.lastError = null;
      state.history = addSample(state.history, { t: model.fetchedAt, missed: Object.fromEntries(model.witnesses.map((w) => [w.owner, w.totalMissed])) });
      saveHistory(node, state.history);
      const icon = { progressing: '▲', lagging: '▲', stalled: '■', not_started: '◔' }[model.network.status] ?? '■';
      document.title = `${icon} #${model.network.headBlock} · Pixagram Witness Status`;
    }
  } catch (e) {
    state.lastError = e;
    console.error(e);
  }
  state.fetching = false;
  $('main').classList.remove('busy');
  render();
  if (state.pending) {
    state.pending = false;
    refresh();
  } else {
    arm();
  }
}

function arm() {
  clearTimeout(state.timer);
  state.timer = null;
  const s = state.settings.interval;
  if (!s || document.hidden) { state.nextAt = null; renderCountdown(); return; }
  state.nextAt = Date.now() + s * 1000;
  state.timer = setTimeout(refresh, s * 1000);
  renderCountdown();
}

function renderCountdown() {
  const el = $('countdown');
  if (state.fetching) el.textContent = '…';
  else if (!state.settings.interval) el.textContent = 'paused';
  else if (state.nextAt == null) el.textContent = 'idle';
  else el.textContent = `${Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000))}s`;
}

const view = () => ({
  sort: state.settings.sort, dir: state.settings.dir, q: state.settings.q, hideDisabled: state.settings.hideDisabled,
  hidden: state.hidden, expanded: state.expanded, voters: state.voters,
});

function render() {
  const m = state.model;
  const h = state.health;
  if (state.lastError) setStatus(`error: ${state.lastError.message}${m ? ` — showing data from ${fmtTime(m.fetchedAt)}` : ''}`, 'err');
  else if (m) setStatus(`ok · ${m.latencyMs} ms${m.errors.length ? ` · ${m.errors.length} partial error(s)` : ''}`, m.errors.length ? 'warn' : 'ok');
  if (!m) {
    $('network').innerHTML = `<div class="net crit"><div class="net-main"><span class="net-icon">✖</span><span class="net-label">NO DATA</span><span class="net-detail">${R.esc(state.lastError?.message ?? '')} — check the node URL (it must allow CORS) and try again.</span></div></div>`;
    return;
  }
  $('network').innerHTML = R.renderNetwork(m, h);
  $('tiles').innerHTML = R.renderTiles(m);
  $('schedule').innerHTML = R.renderSchedule(m);
  $('schedule-meta').textContent = R.scheduleMeta(m);
  $('blocks').innerHTML = R.renderBlocks(m, colorOf);
  $('blocks-meta').textContent = R.blocksMeta(m);
  renderTable();
  $('footer-meta').innerHTML = `Last refresh ${R.ageSpan(m.fetchedAt)} (${fmtTime(m.fetchedAt)}) · chain time ${R.esc(m.network.headTime)} UTC · partial errors: ${m.errors.length ? R.esc(m.errors.join('; ')) : 'none'}`;
}

function renderTable() {
  const m = state.model;
  if (!m) return;
  const v = view();
  $('tbl').querySelector('thead').innerHTML = R.renderTableHead(v);
  $('tbl').querySelector('tbody').innerHTML = R.renderTableBody(m, state.health, v);
  const shown = R.visibleRows(m, v).length;
  $('witnesses-meta').textContent = `${shown} of ${m.counts.total} shown · sorted by ${state.settings.sort} ${state.settings.dir} · click a header to sort, a row for details`;
}

async function toggleRow(owner) {
  if (state.expanded.has(owner)) {
    state.expanded.delete(owner);
    renderTable();
    return;
  }
  state.expanded.add(owner);
  renderTable();
  if (!state.voters.has(owner)) {
    try {
      state.voters.set(owner, await fetchVoters(state.settings.node, owner));
    } catch (e) {
      console.error(e);
      state.voters.set(owner, null);
    }
    renderTable();
  }
}

function setIntervalSeconds(v) {
  state.settings.interval = v;
  persistSettings();
  syncIntervalControl();
  arm();
}
function syncIntervalControl() {
  const sel = $('interval');
  const custom = $('interval-custom');
  const v = String(state.settings.interval);
  if ([...sel.options].some((o) => o.value === v)) {
    sel.value = v;
    custom.hidden = true;
  } else {
    sel.value = 'custom';
    custom.hidden = false;
    custom.value = v;
  }
}
function setNode(url) {
  if (!/^https?:\/\/\S+$/.test(url)) { setStatus('node must be an http(s) URL', 'err'); return; }
  if (url === state.settings.node) { refresh(); return; }
  state.settings.node = url;
  persistSettings();
  Object.assign(state, { config: null, blocks: [], model: null, prev: null, sessionBase: null, health: null, history: loadHistory(url), colors: new Map(), expanded: new Set(), voters: new Map(), lastError: null });
  refresh();
}

function init() {
  const sel = $('interval');
  sel.innerHTML = INTERVALS.map((s) => `<option value="${s}">${s} s</option>`).join('') + '<option value="0">paused</option><option value="custom">custom…</option>';
  syncIntervalControl();
  sel.addEventListener('change', () => {
    if (sel.value === 'custom') {
      $('interval-custom').hidden = false;
      $('interval-custom').value = state.settings.interval;
      $('interval-custom').focus();
      return;
    }
    setIntervalSeconds(Number(sel.value));
  });
  $('interval-custom').addEventListener('change', () => setIntervalSeconds(Math.max(0, Math.min(3600, Math.round(Number($('interval-custom').value) || 0)))));
  $('node').value = state.settings.node;
  $('node').addEventListener('change', () => setNode($('node').value.trim()));
  $('node').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setNode($('node').value.trim()); } });
  $('refresh').addEventListener('click', () => refresh());

  const win = $('window');
  win.innerHTML = WINDOWS.map((w) => `<option value="${w}">${w} blocks</option>`).join('');
  win.value = String(state.settings.window);
  win.addEventListener('change', () => { state.settings.window = Number(win.value); state.blocks = []; persistSettings(); refresh(); });

  $('q').value = state.settings.q;
  $('q').addEventListener('input', () => { state.settings.q = $('q').value.trim().toLowerCase().slice(0, 64); persistSettings(); renderTable(); });
  $('hide-disabled').checked = state.settings.hideDisabled;
  $('hide-disabled').addEventListener('change', () => { state.settings.hideDisabled = $('hide-disabled').checked; persistSettings(); renderTable(); });

  $('columns-menu').innerHTML = R.renderColumnsMenu(state.hidden);
  $('columns-menu').addEventListener('change', (e) => {
    const key = e.target.dataset.col;
    if (!key) return;
    if (e.target.checked) state.hidden.delete(key); else state.hidden.add(key);
    try { storage?.setItem(COLS_KEY, JSON.stringify([...state.hidden])); } catch { /* ignore */ }
    renderTable();
  });

  $('tbl').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const key = th.dataset.sort;
      if (state.settings.sort === key) state.settings.dir = state.settings.dir === 'asc' ? 'desc' : 'asc';
      else {
        state.settings.sort = key;
        const col = COLUMNS.find((c) => c.key === key);
        state.settings.dir = col?.type === 'num' && !['rank', 'status'].includes(key) ? 'desc' : 'asc';
      }
      persistSettings();
      renderTable();
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); copy.textContent = 'copied'; return; }
    if (e.target.closest('a, tr.details')) return;
    const row = e.target.closest('tr.row');
    if (row) toggleRow(row.dataset.owner);
  });

  $('copy-json').addEventListener('click', async () => {
    if (!state.model) return;
    await navigator.clipboard?.writeText(JSON.stringify(snapshotDocument(state.model, state.health), null, 2));
    $('copy-json').textContent = 'copied ✓';
    setTimeout(() => { $('copy-json').textContent = 'copy model JSON'; }, 1500);
  });

  const tip = $('tip');
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left))}px`;
    tip.style.top = `${r.bottom + 6 + window.scrollY}px`;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(state.timer); state.timer = null; }
    else if (state.settings.interval && (state.nextAt == null || state.nextAt <= Date.now())) refresh();
    else arm();
  });
  setInterval(() => { renderCountdown(); R.tickAges(document.body); }, 1000);

  state.history = loadHistory(state.settings.node);
  refresh();
}

init();
