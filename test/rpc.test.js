import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcBatch, rpcCall, RpcError } from '../src/lib/rpc.js';
import { fakeNode } from './helpers.js';

const call = (method) => ({ method, params: [] });

test('rpcBatch returns results in call order even if the node reorders them', async () => {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(Array.isArray(body), 'always sends a batch array');
    return new Response(JSON.stringify(body.map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.method })).reverse()));
  };
  const { results } = await rpcBatch('https://node', [call('a'), { method: 'b', params: {} }], { fetchImpl });
  assert.deepEqual(results.map((r) => r.result), ['a', 'b']);
});

test('rpcBatch surfaces per-call errors without throwing', async () => {
  const { results } = await rpcBatch('https://node', [call('nope')], { fetchImpl: fakeNode({}) });
  assert.match(results[0].error.message, /Could not find method nope/);
});

test('rpcBatch throws RpcError kind=http on non-2xx', async () => {
  const fetchImpl = async () => new Response('bad gateway', { status: 502 });
  await assert.rejects(rpcBatch('https://node', [call('a')], { fetchImpl }), (e) => e instanceof RpcError && e.kind === 'http' && e.status === 502);
});

test('rpcBatch throws RpcError kind=parse on a non-JSON body', async () => {
  const fetchImpl = async () => new Response('<html>405 Not Allowed</html>', { status: 200 });
  await assert.rejects(rpcBatch('https://node', [call('a')], { fetchImpl }), (e) => e instanceof RpcError && e.kind === 'parse');
});

test('rpcBatch throws RpcError kind=timeout when the request is aborted', async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(rpcBatch('https://node', [call('a')], { fetchImpl, timeoutMs: 5 }), (e) => e instanceof RpcError && e.kind === 'timeout');
});

test('rpcBatch throws RpcError kind=network when fetch rejects', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(rpcBatch('https://node', [call('a')], { fetchImpl }), (e) => e instanceof RpcError && e.kind === 'network');
});

test('rpcBatch reports a missing response entry as an error', async () => {
  const fetchImpl = async () => new Response(JSON.stringify([{ jsonrpc: '2.0', id: 1, result: 1 }]));
  const { results } = await rpcBatch('https://node', [call('a'), call('b')], { fetchImpl });
  assert.equal(results[0].result, 1);
  assert.match(results[1].error.message, /no response for b/);
});

test('rpcBatch measures latency', async () => {
  const { latencyMs } = await rpcBatch('https://node', [call('a')], { fetchImpl: fakeNode({ a: () => 1 }) });
  assert.ok(latencyMs >= 0);
});

test('rpcCall unwraps the single result', async () => {
  assert.equal(await rpcCall('https://node', 'a', [], { fetchImpl: fakeNode({ a: () => 42 }) }), 42);
});

test('rpcCall throws RpcError kind=rpc on a JSON-RPC error', async () => {
  await assert.rejects(rpcCall('https://node', 'nope', [], { fetchImpl: fakeNode({}) }), (e) => e instanceof RpcError && e.kind === 'rpc' && e.method === 'nope');
});
