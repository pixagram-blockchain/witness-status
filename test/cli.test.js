// Run the real CLI against a local fake JSON-RPC node and read its stdout through a pipe,
// the way a bot capturing the output would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fakeNode } from './helpers.js';
import * as fx from './fixtures.js';

async function withNode(handlers, fn) {
  const answer = fakeNode(handlers);
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const r = await answer('', { body });
    res.writeHead(200, { 'content-type': 'application/json' }).end(await r.text());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [new URL('../bin/witness-status.mjs', import.meta.url).pathname, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.on('close', (code) => resolve({ code, stdout }));
  });
}

test('the CLI writes its whole JSON document to a pipe, even past 64 KB', async () => {
  await withNode(fx.handlers({ dgp: { head_block_number: 1000 } }), async (node) => {
    const { code, stdout } = await run(['--node', node, '--window', '1000', '--format', 'json']);
    assert.equal(code, 0);
    assert.ok(stdout.length > 65536, `fixture output is ${stdout.length} bytes, too small to test truncation`);
    assert.equal(JSON.parse(stdout).model.blocks.window.length, 1000);
  });
});

test('--check still exits with the health code after writing the document', async () => {
  // A head block from genesis day is long stale, so health is critical (exit code 2).
  const stalled = fx.handlers({ dgp: { head_block_number: 1000, time: '2026-09-04T12:00:00' } });
  await withNode(stalled, async (node) => {
    const { code, stdout } = await run(['--node', node, '--window', '1000', '--check']);
    const doc = JSON.parse(stdout);
    assert.equal(code, doc.health.exitCode);
    assert.equal(code, 2);
  });
});
