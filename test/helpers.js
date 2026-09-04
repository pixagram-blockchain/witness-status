// A fake JSON-RPC node for tests: routes each call by method name.
export function fakeNode(handlers, calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const reqs = Array.isArray(body) ? body : [body];
    const out = reqs.map((r) => {
      calls.push({ method: r.method, params: r.params });
      const h = handlers[r.method];
      if (!h) return { jsonrpc: '2.0', id: r.id, error: { code: -32002, message: `Could not find method ${r.method}` } };
      try {
        return { jsonrpc: '2.0', id: r.id, result: h(r.params) };
      } catch (e) {
        return { jsonrpc: '2.0', id: r.id, error: { code: -32003, message: e.message } };
      }
    });
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
