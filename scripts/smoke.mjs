// Live smoke test: fetch + derive + health against a real node, print the text report.
import { fetchSnapshot, DEFAULT_NODE } from '../src/lib/chain.js';
import { derive } from '../src/lib/derive.js';
import { evaluate } from '../src/lib/health.js';
import { textReport } from '../src/lib/report.js';

const node = process.argv[2] ?? DEFAULT_NODE;
const raw = await fetchSnapshot(node, { window: 100 });
const model = derive(raw);
const health = evaluate(model);
console.log(textReport(model, health));
console.log(`\nmodel: ${model.witnesses.length} witnesses, ${model.blocks.windowSize} blocks, ${Object.keys(model).length} top-level keys; health ${health.level}`);
