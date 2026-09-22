import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickAges } from '../src/ui/render.js';

test('age ticking updates changed labels without replacing unchanged text', () => {
  let writes = 0;
  let text = '1h 0m ago';
  const el = { dataset: { ts: '0' }, get textContent() { return text; }, set textContent(value) { writes++; text = value; } };
  const root = { querySelectorAll: () => [el] };
  tickAges(root, 3600_000);
  assert.equal(writes, 0);
  tickAges(root, 3660_000);
  assert.equal(text, '1h 1m ago');
  assert.equal(writes, 1);
});
