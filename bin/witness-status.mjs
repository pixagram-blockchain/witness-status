#!/usr/bin/env node
// CLI: same fetch + derive + health pipeline as the web page, for bots and cron jobs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchSnapshot } from '../src/lib/chain.js';
import { derive } from '../src/lib/derive.js';
import { evaluate } from '../src/lib/health.js';
import { parseArgs, textReport, snapshotDocument, USAGE } from '../src/lib/report.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(USAGE); process.exit(0); }
if (args.error) { console.error(`error: ${args.error}\n\n${USAGE}`); process.exit(64); }

let prev = null;
if (args.previous) {
  try {
    const doc = JSON.parse(await readFile(args.previous, 'utf8'));
    prev = doc.model ?? null;
    if (!prev) console.error('warning: previous snapshot has no model; deltas disabled');
  } catch (e) {
    console.error(`warning: cannot read previous snapshot (${e.message}); deltas disabled`);
  }
}

let model;
let health;
try {
  const raw = await fetchSnapshot(args.node, { window: args.window, prevBlocks: prev?.blocks?.window ?? [] });
  model = derive(raw, { prev });
  health = evaluate(model);
} catch (e) {
  console.error(`fetch failed: ${e.message}`);
  process.exit(3);
}

const doc = snapshotDocument(model, health);
if (args.out) {
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'status.json'), JSON.stringify(doc, null, 2) + '\n');
  await writeFile(join(args.out, 'status.txt'), textReport(model, health) + '\n');
  console.error(`wrote ${join(args.out, 'status.json')} and status.txt (${health.level})`);
} else if (args.format === 'text') {
  console.log(textReport(model, health));
} else {
  console.log(JSON.stringify(doc, null, 2));
}
process.exit(args.check ? health.exitCode : 0);
