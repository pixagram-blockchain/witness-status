// Minimal JSON-RPC 2.0 batch client. Works in browsers and Node (global fetch).

export class RpcError extends Error {
  constructor(message, { kind, status = null, method = null, cause = null } = {}) {
    super(message);
    this.name = 'RpcError';
    this.kind = kind; // 'http' | 'network' | 'timeout' | 'parse' | 'rpc'
    this.status = status;
    this.method = method;
    this.cause = cause;
  }
}

// calls: [{ method, params }] → { results: [{ result } | { error }], latencyMs }
// Results come back in call order regardless of the order the node answers in.
export async function rpcBatch(node, calls, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', method: c.method, params: c.params ?? [], id: i + 1 }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  let res;
  let text;
  try {
    res = await fetchImpl(node, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    const timedOut = e?.name === 'AbortError';
    throw new RpcError(timedOut ? `timeout after ${timeoutMs} ms` : `network error: ${e?.message ?? e}`, { kind: timedOut ? 'timeout' : 'network', cause: e });
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new RpcError(`HTTP ${res.status}`, { kind: 'http', status: res.status });
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new RpcError('response is not JSON (is this a JSON-RPC node?)', { kind: 'parse', cause: e });
  }
  const byId = new Map((Array.isArray(json) ? json : [json]).map((r) => [r.id, r]));
  const results = body.map((req) => {
    const r = byId.get(req.id);
    if (!r) return { error: { message: `no response for ${req.method}` } };
    return r.error ? { error: r.error } : { result: r.result };
  });
  return { results, latencyMs };
}

export async function rpcCall(node, method, params, opts) {
  const { results } = await rpcBatch(node, [{ method, params }], opts);
  if (results[0].error) throw new RpcError(`${method}: ${results[0].error.message}`, { kind: 'rpc', method });
  return results[0].result;
}
