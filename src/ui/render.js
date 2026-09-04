// HTML string builders. Pure functions of the model; no state, no fetches.
import { COLUMNS, sortRows } from '../lib/columns.js';
import { fmtInt, fmtNum, fmtCompact, fmtPct, fmtDuration, fmtAge, fmtBytes, shortKey, fmtTime } from '../lib/format.js';
import { parseUtc } from '../lib/assets.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_ICON = { active: '●', standby: '○', disabled: '✕' };
const NET = {
  progressing: { icon: '▲', label: 'PROGRESSING', cls: 'good' },
  lagging: { icon: '▲', label: 'LAGGING', cls: 'warn' },
  stalled: { icon: '■', label: 'STALLED', cls: 'crit' },
  not_started: { icon: '◔', label: 'NOT STARTED', cls: 'info' },
};
const LEVEL_ICON = { info: 'ℹ', warn: '⚠', critical: '✖' };
const LEVEL_RANK = { info: 1, warn: 2, critical: 3 };

// Relative ages are re-rendered every second by tickAges() without touching the rest of the DOM.
export function ageSpan(ms) {
  if (ms == null || Number.isNaN(ms)) return '–';
  return `<span class="age" data-ts="${ms}" title="${fmtTime(ms)}">${esc(fmtAge((Date.now() - ms) / 1000))}</span>`;
}
export function tickAges(root, now = Date.now()) {
  for (const el of root.querySelectorAll('.age[data-ts]')) el.textContent = fmtAge((now - Number(el.dataset.ts)) / 1000);
}

const flagChip = (f, withMessage) => `<span class="flag ${f.level}" title="${esc(f.message)}">${LEVEL_ICON[f.level] ?? ''} ${esc(f.code)}${withMessage ? ': ' + esc(f.message) : ''}</span>`;

export function renderNetwork(m, h) {
  const n = m.network;
  const s = NET[n.status] ?? NET.stalled;
  let detail;
  if (n.status === 'not_started') {
    detail = `genesis ${esc(n.genesisTime)} UTC · starts ${ageSpan(parseUtc(n.genesisTime))} · ${m.counts.total} witness${m.counts.total === 1 ? '' : 'es'} registered, ${m.schedule.n} scheduled`;
  } else {
    const rate = n.rate
      ? `${n.rate.headDelta} block${n.rate.headDelta === 1 ? '' : 's'} in ${fmtDuration(n.rate.elapsedSec)} = ${n.rate.observed.toFixed(3)} blk/s (${(n.rate.ratio * 100).toFixed(0)}% of expected)`
      : 'block rate: measured from the next refresh';
    detail = `head <b>#${fmtInt(n.headBlock)}</b> ${ageSpan(parseUtc(n.headTime))} by <b>${esc(n.currentWitness)}</b> · LIB #${fmtInt(n.lib)} (lag ${n.libLag}) · ${rate}`;
  }
  const flags = h.network.map((f) => flagChip(f, true)).join('');
  const strip = n.recentSlots.map((ok, i) => `<i class="${ok ? 'ok' : 'miss'}" data-tip="slot ${i - 127}: ${ok ? 'produced' : 'missed'}"></i>`).join('');
  return `<div class="net ${s.cls}">
    <div class="net-main"><span class="net-icon">${s.icon}</span><span class="net-label">${s.label}</span><span class="net-detail">${detail}</span></div>
    <div class="net-part"><span class="muted">last 128 slots</span><span class="strip part">${strip}</span><b>${fmtPct(n.participationPct)}</b><span class="muted">(${n.participationCount}/128 filled, ${128 - n.participationCount} missed)</span></div>
    ${flags ? `<div class="flags">${flags}</div>` : ''}</div>`;
}

const tile = (label, value, sub = '') => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;

export function renderTiles(m) {
  const n = m.network;
  const c = m.chain;
  const s = m.schedule;
  const plural = (x, w) => `${x} ${w}${x === 1 ? '' : 's'}`;
  return [
    tile('Head block', `#${fmtInt(n.headBlock)}`, `${esc(n.headTime)} UTC · id ${esc(n.headBlockId.slice(0, 16))}…`),
    tile('Irreversible', `#${fmtInt(n.lib)}`, `lag ${plural(n.libLag, 'block')} (${fmtDuration(n.libLag * c.blockInterval)})`),
    tile('Witnesses', String(m.counts.total), `${m.counts.active} active · ${m.counts.standby} standby · ${m.counts.disabled} disabled`),
    tile('Scheduled', `${s.n} <small>/ ${c.maxWitnesses}</small>`, `${s.maxVoted} voted + ${s.maxRunner} timeshare + ${s.maxMiner} miner slots`),
    tile('Missed slots', fmtInt(n.missedSlotsTotal), `all time · aslot ${fmtInt(n.currentAslot)} vs head #${fmtInt(n.headBlock)}`),
    tile('Median feed', `${fmtNum(c.medianFeed.price)} <small>PIXA/PXS</small>`, `${plural(c.feedCount, 'feed')} in window · min ${fmtNum(c.minFeed)} · max ${fmtNum(c.maxFeed)}`),
    tile('Versions', esc(c.majorityVersion), `majority · node ${esc(c.nodeVersion)} (${esc(String(c.nodeRevision).slice(0, 8))}) · HF ${esc(c.hfCurrent)}${c.hfNext && c.hfNext !== '0.0.0' ? ' → ' + esc(c.hfNext) : ''}`),
    tile('VESTS : PIXA', fmtNum(c.vestingRatio, 6), `${fmtCompact(c.totalVests)} VESTS ↔ ${fmtCompact(c.totalVestingFundPixa)} PIXA vested`),
    tile('Median props', `${fmtNum(c.medianProps.accountCreationFee)} <small>PIXA fee</small>`, `max block ${fmtBytes(c.medianProps.maxBlockSize)} · subsidy ${c.medianProps.subsidyBudget}/${c.medianProps.subsidyDecay} · PXS interest ${c.medianProps.pxsInterestRate / 100}%`),
    tile('Supply', `${fmtCompact(c.supply.pixa)} <small>PIXA</small>`, `${fmtCompact(c.supply.pxs)} PXS · virtual ${fmtCompact(c.supply.virtual)} PIXA`),
    tile('RPC', `${fmtInt(m.latencyMs)} <small>ms</small>`, `${esc(m.node.replace(/^https?:\/\//, ''))} · fetched ${ageSpan(m.fetchedAt)}`),
  ].join('');
}

export function renderSchedule(m) {
  const s = m.schedule;
  if (!s.shuffled.length) return '<span class="muted">no witnesses scheduled</span>';
  return `<div class="chips">${s.shuffled.map((w, i) => {
    const cur = i === s.currentIndex;
    const next = i === s.nextIndex && !cur;
    return `<span class="chip ${cur ? 'cur' : next ? 'next' : ''}"><span class="slot">${i}</span>${esc(w)}${cur ? '<span class="tag">now</span>' : next ? '<span class="tag">next</span>' : ''}</span>`;
  }).join('')}</div>`;
}
export const scheduleMeta = (m) => `${m.schedule.n} of ${m.chain.maxWitnesses} slots filled · producer = shuffled[aslot mod ${m.schedule.n}] · reshuffle at #${fmtInt(m.schedule.nextShuffleBlock)} (in ${m.schedule.blocksToShuffle} block${m.schedule.blocksToShuffle === 1 ? '' : 's'})`;

export function renderBlocks(m, colorOf) {
  const b = m.blocks;
  if (!b.windowSize) return '<span class="muted">no blocks yet</span>';
  const ticks = [];
  for (const blk of b.window) {
    for (let g = 0; g < Math.min(blk.gapBefore, 50); g++) ticks.push(`<i class="gap" data-tip="missed slot before #${blk.num}"></i>`);
    ticks.push(`<i class="s${colorOf(blk.witness)}" data-tip="#${blk.num} · ${esc(blk.witness)} · ${esc(blk.timestamp)} UTC · ${blk.txCount} tx"></i>`);
  }
  const legend = Object.entries(b.perWitness).sort((x, y) => y[1] - x[1])
    .map(([w, c]) => `<span class="lg"><i class="sw s${colorOf(w)}"></i>${esc(w)} <b>${c}</b> <span class="muted">(${fmtPct((c / b.windowSize) * 100, 0)})</span></span>`).join('');
  const missed = b.missedSlotsInWindow ? `<span class="lg"><i class="sw gap"></i>missed slots <b>${b.missedSlotsInWindow}</b></span>` : '';
  return `<div class="strip blocks">${ticks.join('')}</div><div class="legend">${legend}${missed}</div>`;
}
export const blocksMeta = (m) => (m.blocks.windowSize
  ? `#${fmtInt(m.blocks.first)} – #${fmtInt(m.blocks.last)} · ${fmtDuration(m.blocks.spanSec)} · ${fmtInt(m.blocks.txTotal)} tx · ${m.blocks.missedSlotsInWindow} missed slot${m.blocks.missedSlotsInWindow === 1 ? '' : 's'}`
  : 'waiting for blocks');

export const renderColumnsMenu = (hidden) => COLUMNS.map((c) => `<label><input type="checkbox" data-col="${c.key}" ${hidden.has(c.key) ? '' : 'checked'}> ${esc(c.label)} <span class="muted">${esc(c.key)}</span></label>`).join('');

export function renderTableHead(view) {
  const cols = COLUMNS.filter((c) => !view.hidden.has(c.key));
  return `<tr>${cols.map((c) => `<th data-sort="${c.key}" class="${c.align === 'r' ? 'r ' : ''}${view.sort === c.key ? view.dir : ''}" title="${esc(c.title)} — click to sort">${esc(c.label)}<span class="ind"></span></th>`).join('')}<th class="x"></th></tr>`;
}

const delta = (d) => (d == null ? '–' : d > 0 ? `<span class="crit-text">+${d}</span>` : '0');
const deltaH = (x) => (x == null ? '–' : `${delta(x.delta)}${x.partial ? `<span class="muted" title="history only covers since ${fmtTime(x.sinceT)}">*</span>` : ''}`);
const bar = (v, max, label, title) => `<span class="barcell" title="${esc(title)}"><span class="bar" style="width:${v > 0 && max > 0 ? Math.max(2, (v / max) * 100) : 0}%"></span><span>${label}</span></span>`;

function cell(key, w, m, { maxVotes, maxProduced, flags }) {
  switch (key) {
    case 'rank': return String(w.rank);
    case 'owner': {
      const url = w.url && /^https?:\/\//.test(w.url) ? ` <a class="ext" href="${esc(w.url)}" target="_blank" rel="noopener" title="${esc(w.url)}">↗</a>` : '';
      const badges = flags.filter((f) => f.level !== 'info' || f.code === 'disabled').map((f) => flagChip(f, false)).join('');
      return `<b>${esc(w.owner)}</b>${w.isCurrentProducer ? '<span class="prod" title="produced the head block">● producing</span>' : ''}${url}${badges ? `<div class="badges">${badges}</div>` : ''}`;
    }
    case 'status': return `<span class="st ${w.status}">${STATUS_ICON[w.status]} ${w.status}</span>`;
    case 'votesVests': return bar(w.votesVests, maxVotes, fmtCompact(w.votesVests), `${fmtNum(w.votesVests, 6)} VESTS (raw ${fmtInt(w.votes)})`);
    case 'votesPixa': return fmtInt(w.votesPixa);
    case 'voteShare': return fmtPct(w.voteShare * 100);
    case 'voters': return w.voters == null ? '–' : `${fmtInt(w.voters)}${w.votersTruncated ? '+' : ''}`;
    case 'totalMissed': return fmtInt(w.totalMissed);
    case 'missedSinceLoad': return delta(w.missedSinceLoad);
    case 'missed1h': return deltaH(w.missed1h);
    case 'missed24h': return deltaH(w.missed24h);
    case 'producedInWindow': return bar(w.producedInWindow, maxProduced, fmtInt(w.producedInWindow), `${fmtPct(w.windowShare * 100)} of the window`);
    case 'lastConfirmedBlock': return w.lastConfirmedBlock
      ? `#${fmtInt(w.lastConfirmedBlock)} <span class="muted">${fmtInt(w.blocksSinceConfirmed)} blk · ${fmtDuration(w.secondsSinceConfirmed)} ago</span>`
      : '<span class="muted">never</span>';
    case 'feedPrice': return w.feed.price == null ? '<span class="muted">none</span>' : fmtNum(w.feed.price);
    case 'feedAgeSec': return w.feed.ageSec == null ? '<span class="muted">never</span>' : `<span class="${w.feed.stale ? 'warn-text' : ''}">${fmtDuration(w.feed.ageSec)}</span>`;
    case 'feedDeviationPct': return w.feed.deviationPct == null ? '–' : `${w.feed.deviationPct >= 0 ? '+' : ''}${fmtPct(w.feed.deviationPct, 2)}`;
    case 'version': return `<span class="${w.version.behind ? 'warn-text' : ''}">${esc(w.version.running)}</span>`;
    case 'hfVote': return `${esc(w.hfVote.version)} <span class="muted" title="${esc(w.hfVote.time)} UTC">${esc(String(w.hfVote.time).slice(0, 10))}</span>`;
    case 'accountCreationFee': return fmtNum(w.props.accountCreationFee);
    case 'maxBlockSize': return `${fmtBytes(w.props.maxBlockSize)}${w.props.maxBlockSizeDiffers ? ' <span class="muted">≠ median</span>' : ''}`;
    case 'ownVests': return w.account ? fmtCompact(w.account.vests) : '–';
    case 'signingKey': return `<code title="${esc(w.signingKey)}">${esc(shortKey(w.signingKey))}</code>`;
    default: return '';
  }
}

export function visibleRows(m, view) {
  let rows = m.witnesses;
  if (view.q) rows = rows.filter((w) => w.owner.includes(view.q));
  if (view.hideDisabled) rows = rows.filter((w) => w.status !== 'disabled');
  return sortRows(rows, view.sort, view.dir);
}

export function renderTableBody(m, h, view) {
  const rows = visibleRows(m, view);
  const cols = COLUMNS.filter((c) => !view.hidden.has(c.key));
  const maxVotes = Math.max(0, ...m.witnesses.map((w) => w.votesVests));
  const maxProduced = Math.max(0, ...m.witnesses.map((w) => w.producedInWindow));
  const out = [];
  for (const w of rows) {
    const flags = h.witnesses[w.owner] ?? [];
    const open = view.expanded.has(w.owner);
    out.push(`<tr class="row ${w.status}${w.isCurrentProducer ? ' producing' : ''}${open ? ' open' : ''}" data-owner="${esc(w.owner)}">`
      + cols.map((c) => `<td class="${c.align === 'r' ? 'r ' : ''}c-${c.key}">${cell(c.key, w, m, { maxVotes, maxProduced, flags })}</td>`).join('')
      + `<td class="x"><button class="expand" type="button" aria-label="details" aria-expanded="${open}">${open ? '▾' : '▸'}</button></td></tr>`);
    if (open) out.push(`<tr class="details"><td colspan="${cols.length + 1}">${renderDetails(w, m, flags, view.voters.get(w.owner))}</td></tr>`);
  }
  if (!rows.length) out.push(`<tr><td colspan="${cols.length + 1}" class="muted">no witnesses match</td></tr>`);
  return out.join('');
}

export function worstLevel(flags) {
  return flags.reduce((m, f) => (LEVEL_RANK[f.level] > (LEVEL_RANK[m] ?? 0) ? f.level : m), 'ok');
}

export function renderDetails(w, m, flags, voters) {
  const kv = (k, v, t = '') => `<div class="kv"${t ? ` title="${esc(t)}"` : ''}><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const a = w.account;
  const hist = (x) => (x == null ? '–' : `${x.delta}${x.partial ? '*' : ''}`);
  const groups = [
    ['Identity', [
      kv('owner', esc(w.owner)), kv('witness id', String(w.id)), kv('created', w.created ? esc(w.created) + ' UTC' : 'genesis'),
      kv('url', w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.url)}</a>` : '–'),
      kv('signing key', `<code>${esc(w.signingKey)}</code> <button class="copy" data-copy="${esc(w.signingKey)}" type="button">copy</button>`),
      kv('running version', esc(w.version.running) + (w.version.behind ? ' <span class="warn-text">(behind majority)</span>' : '')),
      kv('hardfork vote', `${esc(w.hfVote.version)} at ${esc(w.hfVote.time)} UTC`),
    ]],
    ['Production', [
      kv('total missed', fmtInt(w.totalMissed)),
      kv('missed Δ session / 1h / 24h', `${w.missedSinceLoad ?? '–'} / ${hist(w.missed1h)} / ${hist(w.missed24h)}`, '* = history shorter than the window'),
      kv('last confirmed block', w.lastConfirmedBlock ? `#${fmtInt(w.lastConfirmedBlock)} (${fmtInt(w.blocksSinceConfirmed)} blocks / ${fmtDuration(w.secondsSinceConfirmed)} ago)` : 'never'),
      kv('last aslot', `${fmtInt(w.lastAslot)}${w.slotsSinceLast != null ? ` (${fmtInt(w.slotsSinceLast)} slots ago)` : ''}`),
      kv('produced in window', `${w.producedInWindow} of ${m.blocks.windowSize} (${fmtPct(w.windowShare * 100)})`),
      kv('shutdown rule', `disabled on the next miss after ${fmtInt(m.chain.shutdownThreshold)} blocks without a confirmed block${w.shutdownRisk ? ' — <b class="crit-text">AT RISK</b>' : ''}`),
      kv('virtual scheduling', `last_update ${esc(w.virtual.lastUpdate)} · position ${esc(w.virtual.position)} · scheduled_time ${esc(w.virtual.scheduledTime)}`, 'timeshare scheduling state used to pick the backup slot'),
    ]],
    ['Stake', [
      kv('votes', `${fmtNum(w.votesVests, 6)} VESTS ≈ ${fmtNum(w.votesPixa)} PIXA (raw ${fmtInt(w.votes)})`),
      kv('share of all votes', fmtPct(w.voteShare * 100, 2)),
      kv('voters', w.voters == null ? '–' : `${w.voters}${w.votersTruncated ? '+' : ''}`),
      kv('account VESTS', a ? `${fmtNum(a.vests, 6)} (delegated out ${fmtNum(a.delegatedVests, 6)}, received ${fmtNum(a.receivedVests, 6)})` : '–'),
      kv('balances', a ? `${fmtNum(a.pixa)} PIXA · ${fmtNum(a.pxs)} PXS` : '–'),
      kv('account created', a ? esc(a.created) + ' UTC' : '–'),
      kv('votes cast / proxy', a ? `${a.witnessesVotedFor} witnesses · proxy ${a.proxy ? esc(a.proxy) : 'none'}` : '–'),
    ]],
    ['Feed & props', [
      kv('price feed', w.feed.price == null ? 'none' : `${fmtNum(w.feed.price)} PIXA per PXS (base ${fmtNum(w.feed.base.amount)} ${esc(w.feed.base.symbol)} / quote ${fmtNum(w.feed.quote.amount)} ${esc(w.feed.quote.symbol)})`),
      kv('feed updated', w.feed.updatedAt ? `${esc(w.feed.updatedAt)} UTC (${fmtDuration(w.feed.ageSec)} ago${w.feed.stale ? ', <span class="warn-text">stale</span>' : ''})` : 'never'),
      kv('feed vs median', w.feed.deviationPct == null ? '–' : `${w.feed.deviationPct >= 0 ? '+' : ''}${fmtPct(w.feed.deviationPct, 2)} (median ${fmtNum(m.chain.medianFeed.price)})`),
      kv('account creation fee', `${fmtNum(w.props.accountCreationFee)} PIXA`),
      kv('max block size', `${fmtInt(w.props.maxBlockSize)} B (${fmtBytes(w.props.maxBlockSize)})${w.props.maxBlockSizeDiffers ? ` ≠ median ${fmtBytes(m.chain.medianProps.maxBlockSize)}` : ''}`),
      kv('PXS interest rate', `${w.props.pxsInterestRate / 100}%`),
      kv('account subsidy', `budget ${w.props.subsidyBudget} · decay ${w.props.subsidyDecay} · available ${fmtInt(w.availableSubsidies)}`),
    ]],
  ];
  const flagsHtml = flags.length ? `<div class="flags">${flags.map((f) => flagChip(f, true)).join('')}</div>` : '<div class="muted">no flags</div>';
  let votersHtml;
  if (voters === undefined) votersHtml = '<span class="muted">loading voters…</span>';
  else if (voters === null) votersHtml = '<span class="muted">voters unavailable</span>';
  else if (!voters.voters.length) votersHtml = '<span class="muted">no voters</span>';
  else {
    votersHtml = `<table class="mini"><thead><tr><th>account</th><th class="r">own VESTS</th><th class="r">proxied</th><th class="r">effective</th></tr></thead><tbody>`
      + voters.voters.map((v) => `<tr><td>${esc(v.account)}</td><td class="r">${fmtCompact(v.vests)}</td><td class="r">${fmtCompact(v.proxiedVests)}</td><td class="r">${fmtCompact(v.effectiveVests)}</td></tr>`).join('')
      + `</tbody></table>${voters.total > voters.voters.length ? `<div class="muted">showing ${voters.voters.length} of ${voters.total}</div>` : ''}<div class="muted">effective = own + proxied VESTS, ignoring delayed votes</div>`;
  }
  return `<div class="det">${groups.map(([t, items]) => `<div class="grp"><h4>${t}</h4>${items.join('')}</div>`).join('')}<div class="grp"><h4>Flags</h4>${flagsHtml}</div><div class="grp"><h4>Top voters</h4>${votersHtml}</div></div>`;
}
