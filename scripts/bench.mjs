// Offline, repeatable CPU benchmark. Optional argument selects a saved checkout for comparison.
// node scripts/bench.mjs [/path/to/checkout]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { raw, witness, blockTime } from '../test/fixtures.js';
import { fakeNode } from '../test/helpers.js';
import { handlers } from '../test/fixtures.js';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(resolve(root, path)));
const { derive } = await load('src/lib/derive.js');
const { evaluate } = await load('src/lib/health.js');
const { renderTableBody } = await load('src/ui/render.js');
const { fetchSnapshot } = await load('src/lib/chain.js');
const { deltaSince } = await load('src/lib/history.js');
const now = Date.parse('2026-09-05T13:00:00Z');
const samples = Array.from({ length: 1500 }, (_, i) => ({ t: now - (1500 - i) * 60000, missed: { w0: i } }));
const view = { sort: 'rank', dir: 'asc', hidden: new Set(), expanded: new Set(), voters: new Map() };
let sink;
function bench(name, iterations, fn) {
  for (let i = 0; i < 10; i++) sink = fn();
  const trials = [];
  for (let j = 0; j < 5; j++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink = fn();
    trials.push((performance.now() - start) / iterations);
  }
  trials.sort((a, b) => a - b);
  console.log(`${name}: ${trials[2].toFixed(4)} ms/op (median of 5)`);
}
for (const count of [8, 1000]) {
  const witnesses = Array.from({ length: count }, (_, i) => witness(`w${i}`, { votes: String((count - i) * 1000000) }));
  const blocks = Array.from({ length: 300 }, (_, i) => ({ num: i + 1, timestamp: blockTime(i + 1), witness: 'w0', txCount: 0 }));
  const snapshot = raw({ witnesses, blocks });
  const model = derive(snapshot, { now, history: samples });
  const health = evaluate(model);
  bench(`derive ${count} witnesses / 25h history`, count === 8 ? 100 : 10, () => derive(snapshot, { now, history: samples }));
  bench(`render ${count} witness rows`, count === 8 ? 100 : 5, () => renderTableBody(model, health, view));
}
bench('history lookup / 25h', 10000, () => deltaSince(samples, 'w0', 1500, 3600, now));
const inner = fakeNode(handlers({ dgp: { head_block_number: 350 } }));
const fetchImpl = async (url, init) => {
  const method = JSON.parse(init.body)[0].method;
  const delay = method === 'condenser_api.get_config' ? 200 : method === 'condenser_api.get_dynamic_global_properties' ? 50 : 100;
  await new Promise((r) => setTimeout(r, delay));
  return inner(url, init);
};
const start = performance.now();
await fetchSnapshot('https://node.test', { fetchImpl });
console.log(`snapshot with controlled RPC delays (config 200/core 50/extras 100/blocks 100 ms): ${(performance.now() - start).toFixed(1)} ms`);
