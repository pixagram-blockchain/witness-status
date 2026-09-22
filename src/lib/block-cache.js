// Small, per-node cache of finalized block summaries. Chain/anchor validation is done
// against the live node by fetchSnapshot before any persisted blocks are displayed.
const key = (node) => `witness-status:blocks:${node}`;
const MAX_BLOCKS = 1000;
const MAX_AGE_MS = 86_400_000;
const validBlock = (b) => b && Number.isSafeInteger(b.num) && b.num > 0
  && typeof b.id === 'string' && /^[0-9a-f]{40}$/i.test(b.id) && parseInt(b.id.slice(0, 8), 16) === b.num
  && typeof b.timestamp === 'string' && Number.isFinite(Date.parse(b.timestamp + 'Z'))
  && typeof b.witness === 'string' && b.witness.length > 0 && b.witness.length <= 64
  && Number.isSafeInteger(b.txCount) && b.txCount >= 0;

export function loadBlockCache(storage, node, now = Date.now()) {
  try {
    const text = storage?.getItem(key(node));
    if (!text || text.length > 400000) return null;
    const c = JSON.parse(text);
    if (c.schema !== 1 || !Number.isFinite(c.savedAt) || c.savedAt > now || now - c.savedAt > MAX_AGE_MS
      || typeof c.chainId !== 'string' || !/^[0-9a-f]{64}$/i.test(c.chainId)
      || !Array.isArray(c.blocks) || !c.blocks.length || c.blocks.length > MAX_BLOCKS) return null;
    if (!c.blocks.every((b, i) => validBlock(b) && (!i || b.num === c.blocks[i - 1].num + 1))) return null;
    return c;
  } catch { return null; }
}

export function saveBlockCache(storage, node, raw, now = Date.now()) {
  try {
    const chainId = raw.core.version.chain_id;
    const finalized = raw.blocks.filter((b) => b.num <= raw.core.dgp.last_irreversible_block_num);
    // Keep the contiguous suffix if an RPC failure left a gap in the window.
    const blocks = [];
    for (let i = finalized.length - 1; i >= 0 && blocks.length < MAX_BLOCKS; i--) {
      const b = finalized[i];
      if (!validBlock(b) || (blocks.length && b.num !== blocks[blocks.length - 1].num - 1)) break;
      blocks.push({ num: b.num, id: b.id, timestamp: b.timestamp, witness: b.witness, txCount: b.txCount });
    }
    if (!blocks.length || !/^[0-9a-f]{64}$/i.test(chainId ?? '')) { storage?.removeItem(key(node)); return; }
    storage?.setItem(key(node), JSON.stringify({ schema: 1, savedAt: now, chainId, blocks: blocks.reverse() }));
  } catch { /* Private browsing and full storage must not prevent live updates. */ }
}
