// Deterministic checked-in bundle: GitHub Pages continues serving the repository root.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const result = await build({
  absWorkingDir: root, entryPoints: ['src/ui/main.js'], outfile: 'assets/app.min.js',
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
  charset: 'utf8', legalComments: 'none', write: false, metafile: true,
  banner: { js: '/*! Pixagram Witness Status | MIT license */' },
});
if (Object.values(result.metafile.outputs).some((o) => o.imports.length)) throw new Error('Browser bundle must be self-contained');
const code = result.outputFiles[0].text;
const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
const htmlPath = resolve(root, 'index.html');
const html = await readFile(htmlPath, 'utf8');
const nextHTML = html.replace(/assets\/app\.min\.js\?v=[a-z0-9]+/g, `assets/app.min.js?v=${hash}`);
if (!nextHTML.includes(`src="assets/app.min.js?v=${hash}"`)) throw new Error('Missing browser bundle entry in index.html');
const jsPath = resolve(root, 'assets/app.min.js');
if (check) {
  const previous = await readFile(jsPath, 'utf8').catch(() => '');
  if (previous !== code || html !== nextHTML) {
    console.error('Browser bundle is stale. Run npm run build and commit assets/app.min.js and index.html.');
    process.exitCode = 1;
  } else console.log(`Bundle verified (${Buffer.byteLength(code)} bytes, ${hash}).`);
} else {
  await writeFile(jsPath, code);
  if (html !== nextHTML) await writeFile(htmlPath, nextHTML);
  console.log(`Built assets/app.min.js (${Buffer.byteLength(code)} bytes, ${hash}).`);
}
