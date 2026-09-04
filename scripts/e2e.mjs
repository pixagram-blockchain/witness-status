// Browser smoke test over the Chrome DevTools Protocol. Needs a local Chrome and a served copy of the page:
//   npm run serve   (in another terminal)   then   node scripts/e2e.mjs [http://127.0.0.1:8000/]
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000/';
const shotPath = process.argv.find((a) => a.startsWith('--shot='))?.slice(7) ?? null;
import { writeFile } from 'node:fs/promises';
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = await mkdtemp(join(tmpdir(), 'ws-e2e-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page'); } catch { /* not up yet */ }
  if (!targets.length) await sleep(200);
}
if (!targets.length) { console.error('chrome did not start'); proc.kill(); process.exit(2); }

const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.result.value;
};
const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
let rendered = false;
for (let i = 0; i < 100 && !rendered; i++) { rendered = await evaluate(`!!document.querySelector('#tbl tbody tr.row')`); if (!rendered) await sleep(200); }
check('table rendered rows', rendered);
check('network banner present', await evaluate(`document.querySelector('#network .net-label')?.textContent`));
check('status pill ok', /^ok/.test(await evaluate(`document.getElementById('status').textContent`)), await evaluate(`document.getElementById('status').textContent`));

await evaluate(`document.querySelector('th[data-sort="totalMissed"]').click()`);
check('sort header marked desc', (await evaluate(`document.querySelector('th[data-sort="totalMissed"]').className`)).includes('desc'));
check('url has sort param', (await evaluate(`location.search`)).includes('sort=totalMissed'));
await evaluate(`document.querySelector('th[data-sort="totalMissed"]').click()`);
check('second click flips to asc', (await evaluate(`document.querySelector('th[data-sort="totalMissed"]').className`)).includes('asc'));

await evaluate(`document.querySelector('#tbl tbody tr.row').click()`);
await sleep(1500);
check('details row shown', await evaluate(`!!document.querySelector('#tbl tbody tr.details .det')`));
check('voters section resolved', !(await evaluate(`/loading voters/.test(document.querySelector('#tbl tbody tr.details').textContent)`)));
await evaluate(`document.querySelector('#tbl tbody tr.row').click()`);
check('details row collapses', !(await evaluate(`!!document.querySelector('#tbl tbody tr.details')`)));

await evaluate(`{ const s = document.getElementById('interval'); s.value = '5'; s.dispatchEvent(new Event('change')); }`);
check('interval persisted in url', (await evaluate(`location.search`)).includes('interval=5'));
check('countdown shows seconds', /\d+s/.test(await evaluate(`document.getElementById('countdown').textContent`)), await evaluate(`document.getElementById('countdown').textContent`));

await evaluate(`{ const q = document.getElementById('q'); q.value = 'zzz'; q.dispatchEvent(new Event('input')); }`);
check('filter hides rows', await evaluate(`!document.querySelector('#tbl tbody tr.row') && /no witnesses match/.test(document.querySelector('#tbl tbody').textContent)`));
await evaluate(`{ const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); }`);
check('filter cleared', await evaluate(`!!document.querySelector('#tbl tbody tr.row')`));

await evaluate(`{ const cb = document.querySelector('#columns-menu input[data-col="voters"]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }`);
check('column hidden', !(await evaluate(`!!document.querySelector('th[data-sort="voters"]')`)));
await evaluate(`{ const cb = document.querySelector('#columns-menu input[data-col="voters"]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }`);
check('column restored', await evaluate(`!!document.querySelector('th[data-sort="voters"]')`));

const before = await evaluate(`document.querySelector('#footer-meta .age')?.dataset.ts`);
await sleep(7500);
const after = await evaluate(`document.querySelector('#footer-meta .age')?.dataset.ts`);
check('auto refresh happened within the 5 s interval', after && after !== before, `${before} → ${after}`);
check('no console errors', errors.length === 0, errors.join(' | '));

if (shotPath) {
  await evaluate(`{ const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); document.querySelector('#tbl tbody tr.row')?.click(); }`);
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(shotPath, Buffer.from(shot.result.data, 'base64'));
  console.log(`screenshot written to ${shotPath}`);
}
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
ws.close();
proc.kill();
process.exit(results.every((r) => r.ok) ? 0 : 1);
