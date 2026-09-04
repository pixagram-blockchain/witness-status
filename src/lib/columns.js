// Sortable column definitions for the witness table. `get` returns the sort value;
// rendering lives in the UI so this file stays usable from Node.
import { compareVersions } from './derive.js';

export const STATUS_ORDER = { active: 0, standby: 1, disabled: 2 };

const col = (key, label, title, type, get, extra = {}) => ({ key, label, title, type, align: type === 'num' ? 'r' : 'l', defaultVisible: true, get, ...extra });
const num = (key, label, title, get, extra) => col(key, label, title, 'num', get, extra);
const str = (key, label, title, get, extra) => col(key, label, title, 'str', get, extra);
const ver = (key, label, title, get, extra) => col(key, label, title, 'version', get, extra);

export const COLUMNS = [
  num('rank', '#', 'Rank by approving stake (witness votes)', (w) => w.rank),
  str('owner', 'Witness', 'Witness account name', (w) => w.owner),
  num('status', 'Status', 'active = in the current schedule; standby = eligible but not scheduled this round; disabled = null signing key', (w) => STATUS_ORDER[w.status] ?? null, { align: 'l' }),
  num('votesVests', 'Votes', 'Approving stake in million VESTS (witness.votes ÷ 1e12)', (w) => w.votesVests),
  num('votesPixa', '≈ PIXA', 'Approving stake converted to PIXA at the current VESTS:PIXA ratio', (w) => w.votesPixa),
  num('voteShare', 'Share', 'This witness’ votes as a share of all witness votes (an account may vote for up to 30 witnesses)', (w) => w.voteShare),
  num('voters', 'Voters', 'Accounts voting for this witness', (w) => w.voters),
  num('totalMissed', 'Missed', 'Blocks missed, all time (witness.total_missed)', (w) => w.totalMissed),
  num('missedSinceLoad', 'Δ session', 'Blocks missed since this page was opened', (w) => w.missedSinceLoad),
  num('missed1h', 'Δ 1h', 'Blocks missed in the last hour, from samples collected while this page was open', (w) => w.missed1h?.delta ?? null),
  num('missed24h', 'Δ 24h', 'Blocks missed in the last 24 hours, from samples collected while this page was open', (w) => w.missed24h?.delta ?? null),
  num('producedInWindow', 'Produced', 'Blocks produced inside the recent-blocks window', (w) => w.producedInWindow),
  num('lastConfirmedBlock', 'Last block', 'Last block this witness produced (witness.last_confirmed_block_num) and its age', (w) => w.lastConfirmedBlock),
  num('feedPrice', 'Feed', 'Published price feed in PIXA per PXS (quote ÷ base)', (w) => w.feed.price),
  num('feedAgeSec', 'Feed age', 'Time since the last price feed publication', (w) => w.feed.ageSec),
  num('feedDeviationPct', 'Feed Δ', 'Deviation of this feed from the current median feed', (w) => w.feed.deviationPct),
  ver('version', 'Version', 'hived version reported in the last block this witness produced', (w) => w.version.running),
  ver('hfVote', 'HF vote', 'Hardfork version this witness votes for', (w) => w.hfVote.version),
  num('accountCreationFee', 'Creation fee', 'Proposed account creation fee in PIXA', (w) => w.props.accountCreationFee),
  num('maxBlockSize', 'Max block', 'Proposed maximum block size in bytes', (w) => w.props.maxBlockSize),
  num('ownVests', 'Own VESTS', 'Vesting shares held by the witness account itself', (w) => w.account?.vests ?? null),
  str('signingKey', 'Signing key', 'Block signing public key', (w) => w.signingKey, { defaultVisible: false }),
];

const cmpOwner = (a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0);

// Stable sort; null/NaN values go last in both directions; ties break by owner name.
export function sortRows(rows, key, dir = 'asc') {
  const c = COLUMNS.find((x) => x.key === key) ?? COLUMNS[0];
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = c.get(a);
    const vb = c.get(b);
    const na = va == null || Number.isNaN(va);
    const nb = vb == null || Number.isNaN(vb);
    if (na && nb) return cmpOwner(a, b);
    if (na) return 1;
    if (nb) return -1;
    const d = c.type === 'num' ? va - vb : c.type === 'version' ? compareVersions(va, vb) : String(va).localeCompare(String(vb));
    return d ? d * sign : cmpOwner(a, b);
  });
}
