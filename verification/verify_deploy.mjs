#!/usr/bin/env node
/**
 * Three-way deploy verifier: local build/ vs deploy.py zip vs LIVE DIRECTORY URL.
 *
 * The load-bearing fetch is the directory URL (…/watershed/), NOT index.html.
 * Fetching index.html is what hid the UTF-16 DirectoryIndex shadow for a month.
 * Both are fetched and decoded the way a browser does (BOM, then Content-Type
 * charset, then <meta charset>): a UTF-8 body under `charset=utf-16` is a blank
 * page in Chrome, and a BOM-only sniff cannot see that (#461). A headless render
 * check then confirms the directory URL loads scripts and has the game title.
 *
 * Usage:
 *   node verification/verify_deploy.mjs
 *   node verification/verify_deploy.mjs --url http://127.0.0.1:4179/
 *   node verification/verify_deploy.mjs --skip-render   # no Chrome available
 *   pnpm verify:deploy
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_LIVE = 'https://test.1ink.us/watershed/';

function parseArgs(argv) {
  const out = {
    url: DEFAULT_LIVE,
    buildDir: path.join(REPO_ROOT, 'build'),
    skipZip: false,
    skipRender: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--build-dir') out.buildDir = path.resolve(argv[++i]);
    else if (a === '--skip-zip') out.skipZip = true;
    else if (a === '--skip-render') out.skipRender = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node verification/verify_deploy.mjs [--url <directory-url>] [--build-dir build] [--skip-zip] [--skip-render]',
      );
      process.exit(0);
    }
  }
  if (!out.url.endsWith('/')) out.url += '/';
  return out;
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** `Content-Type` → `{ essence, charset }`. First `charset` parameter wins, as in the MIME sniffing spec. */
export function parseContentType(value) {
  const [essence = '', ...params] = String(value ?? '').split(';');
  let charset = null;
  for (const param of params) {
    const m = param.trim().match(/^charset\s*=\s*(?:"([^"]*)"|(.*))$/i);
    if (m && charset === null) charset = (m[1] ?? m[2]).trim();
  }
  return { essence: essence.trim().toLowerCase(), charset };
}

/** Charset label → canonical WHATWG encoding name (`utf-16` → `utf-16le`), or null if a browser would ignore it. */
export function resolveCharsetLabel(label) {
  if (!label) return null;
  try {
    return new TextDecoder(String(label).trim()).encoding;
  } catch {
    return null;
  }
}

/** HTML prescan: the first 1024 bytes, `<meta charset=…>` or `<meta http-equiv content="…; charset=…">`. */
function sniffMetaCharset(buf) {
  const head = buf.subarray(0, 1024).toString('latin1');
  const m = head.match(/<meta[^>]+?charset\s*=\s*["']?\s*([^\s"'>;/]+)/i);
  return m ? m[1] : null;
}

/**
 * Decode an HTML response the way a browser does: BOM, then the transport
 * (`Content-Type`) charset, then `<meta charset>`, then the windows-1252 default.
 *
 * Returns `{ encoding, source, transportCharset, text, problems, ok }`. `ok` means the
 * document is UTF-8 HTML *and* is labelled consistently; a UTF-8 BOM under a
 * `charset=utf-16` label still decodes (the BOM wins) but keeps its label problem,
 * so the verifier stays red until the label is fixed.
 */
export function decodeHtml(buf, contentType = '') {
  const { charset: transportCharset } = parseContentType(contentType);
  const transport = resolveCharsetLabel(transportCharset);

  let encoding;
  let source;
  let body = buf;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    encoding = 'utf-8';
    source = 'bom';
    body = buf.subarray(3);
  } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = 'utf-16le';
    source = 'bom';
    body = buf.subarray(2);
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    encoding = 'utf-16be';
    source = 'bom';
    body = buf.subarray(2);
  } else if (transport) {
    encoding = transport;
    source = 'transport';
  } else {
    const meta = resolveCharsetLabel(sniffMetaCharset(buf));
    if (meta) {
      // A UTF-16 <meta> on bytes that are ASCII-compatible is read as UTF-8 (HTML spec).
      encoding = meta === 'utf-16le' || meta === 'utf-16be' ? 'utf-8' : meta;
      source = 'meta';
    } else {
      encoding = 'windows-1252';
      source = 'default';
    }
  }

  const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(body);

  const problems = [];
  if (transportCharset && transport && transport !== 'utf-8') {
    problems.push(
      `Content-Type says charset=${transportCharset} (${transport}), not UTF-8` +
        (transport.startsWith('utf-16') ? ' — the UTF-16 label is what blanked the page' : ''),
    );
  }
  if (encoding !== 'utf-8') {
    problems.push(`a browser decodes this document as ${encoding} (from ${source}), not UTF-8`);
  }
  if (!/^\s*<!doctype\s+html/i.test(text)) {
    problems.push(`decoded text is not an HTML document (starts ${JSON.stringify(text.slice(0, 16))})`);
  }
  return { encoding, source, transportCharset, text, problems, ok: problems.length === 0 };
}

export function parseTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

/**
 * Both documents a visitor can reach — the directory URL and index.html — must decode
 * as UTF-8 and be the build's index.html. `dir` / `index` are `{ buf, contentType }`.
 */
export function checkDirectoryDocuments({ dir, index, builtIndexText }) {
  const failures = [];
  const notes = [];
  const decoded = {};
  for (const [name, res] of [['directory URL', dir], ['index.html', index]]) {
    const dec = decodeHtml(res.buf, res.contentType);
    decoded[name] = dec;
    for (const problem of dec.problems) failures.push(`${name}: ${problem}`);
    if (!dec.transportCharset) notes.push(`${name}: no transport charset (meta charset decides)`);
    if (dec.ok && builtIndexText != null && dec.text !== builtIndexText) {
      failures.push(
        `${name}: decoded document is not build/index.html (${dec.text.length} chars vs ${builtIndexText.length})`,
      );
    }
  }
  if (decoded['directory URL'].text !== decoded['index.html'].text) {
    failures.push(
      'directory URL and index.html decode to different documents — a browser at the directory URL is not loading index.html',
    );
  }
  return { failures, notes, directory: decoded['directory URL'], index: decoded['index.html'] };
}

/** The web build is single-threaded (#454): no response may demand cross-origin isolation. */
export function checkIsolationHeaders(name, { coep, coop }) {
  const failures = [];
  const notes = [];
  if (coep) {
    failures.push(`${name}: sends Cross-Origin-Embedder-Policy: ${coep} — the single-threaded web build must not require it`);
  }
  if (coop) notes.push(`${name}: sends Cross-Origin-Opener-Policy: ${coop} (not needed by the web build)`);
  return { failures, notes };
}

/** `.htaccess` invariants: directory index, UTF-8 charset, and nothing that *sets* COOP/COEP. */
export function checkHtaccess(text) {
  const failures = [];
  const active = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!active.some((l) => /^DirectoryIndex\s+index\.html$/i.test(l))) {
    failures.push('.htaccess lacks "DirectoryIndex index.html"');
  }
  if (!active.some((l) => /^AddDefaultCharset\s+UTF-8$/i.test(l))) {
    failures.push('.htaccess lacks "AddDefaultCharset UTF-8"');
  }
  const addCharset = active
    .map((l) => l.match(/^AddCharset\s+UTF-8\s+(.+)$/i))
    .filter(Boolean)
    .flatMap((m) => m[1].split(/\s+/).map((ext) => ext.toLowerCase()));
  for (const ext of ['.html', '.js', '.wasm']) {
    if (!addCharset.includes(ext)) failures.push(`.htaccess lacks "AddCharset UTF-8 ${ext}"`);
  }
  const isolation = /^Header(?:\s+(?:always|onsuccess|early))?\s+(?:set|add|append|merge|edit\*?|echo)\s+Cross-Origin-(?:Opener|Embedder)-Policy\b/i;
  for (const line of active.filter((l) => isolation.test(l))) {
    failures.push(`.htaccess sets cross-origin isolation (${line}); the web build must not require COOP/COEP`);
  }
  return failures;
}

function resolveChrome(puppeteer) {
  for (const candidate of [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH]) {
    if (candidate) return candidate;
  }
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    /* no puppeteer-managed browser */
  }
  return fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
}

/**
 * Load the directory URL in headless Chrome. Reads the DOM only (no WebGL), so it needs
 * a browser but no GPU. A launch failure is a failure, not a silent skip (`--skip-render`).
 */
export async function renderCheck(url, expectedTitle) {
  const failures = [];
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch (err) {
    return { failures: [`render check: cannot load puppeteer (${err instanceof Error ? err.message : err})`], info: null };
  }
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: resolveChrome(puppeteer),
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const info = await page.evaluate(() => ({
      characterSet: document.characterSet,
      title: document.title,
      scripts: document.scripts.length,
    }));
    info.status = response ? response.status() : null;
    info.coep = response ? response.headers()['cross-origin-embedder-policy'] || null : null;
    if (info.characterSet !== 'UTF-8') failures.push(`render: document.characterSet is ${info.characterSet}, not UTF-8`);
    if (info.scripts === 0) failures.push('render: document.scripts.length is 0 — the page loads no scripts');
    if (!info.title) failures.push('render: document.title is empty');
    else if (expectedTitle && info.title !== expectedTitle) {
      failures.push(`render: document.title is ${JSON.stringify(info.title)}, expected ${JSON.stringify(expectedTitle)}`);
    }
    if (info.coep) failures.push(`render: response carries Cross-Origin-Embedder-Policy: ${info.coep}`);
    return { failures, info };
  } catch (err) {
    return { failures: [`render check could not run: ${err instanceof Error ? err.message : err}`], info: null };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export function parseBuildIdMeta(html) {
  const m = html.match(/<meta\s+name=["']build-id["']\s+content=["']([^"']+)["']\s*\/?>/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']build-id["']\s*\/?>/i);
  return m ? m[1] : null;
}

export function parseAssetRefs(html) {
  const refs = [];
  const re = /(?:src|href)=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const ref = m[1];
    if (ref.startsWith('data:') || ref.startsWith('mailto:') || ref.startsWith('#')) continue;
    refs.push(ref);
  }
  return refs;
}

export function parseEntryScript(html) {
  const m = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i)
    || html.match(/<script[^>]*src=["']([^"']+)["'][^>]*type=["']module["']/i);
  return m ? m[1] : null;
}

function walkBuild(dir) {
  const files = new Map();
  function rec(current) {
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === '__pycache__') continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) rec(full);
      else {
        const rel = path.relative(dir, full).replaceAll('\\', '/');
        const buf = fs.readFileSync(full);
        files.set(rel, { size: buf.length, sha256: sha256(buf) });
      }
    }
  }
  rec(dir);
  return files;
}

function joinUrl(base, rel) {
  return new URL(rel, base).href;
}

async function fetchBuf(url) {
  const res = await fetch(url, {
    headers: { 'Accept-Encoding': 'identity' },
    redirect: 'follow',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const enc = (res.headers.get('content-encoding') || 'identity').toLowerCase();
  const cl = res.headers.get('content-length');
  const headerSize = cl != null && cl !== '' && (enc === 'identity' || enc === '')
    ? Number(cl)
    : null;
  return {
    ok: res.ok,
    status: res.status,
    buf,
    headerSize,
    url: res.url,
    contentType: res.headers.get('content-type') || '',
    coep: res.headers.get('cross-origin-embedder-policy'),
    coop: res.headers.get('cross-origin-opener-policy'),
  };
}

function loadZipManifest() {
  const result = spawnSync('python3', ['deploy.py', '--manifest'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return { ok: false, files: new Map(), error: result.stderr || `exit ${result.status}` };
  }
  const files = new Map();
  for (const line of result.stdout.split('\n')) {
    const tab = line.lastIndexOf('\t');
    if (tab < 0) continue;
    const rel = line.slice(0, tab).replace(/^\.\//, '');
    const size = Number(line.slice(tab + 1));
    if (rel && Number.isFinite(size)) files.set(rel, size);
  }
  return { ok: true, files, error: null };
}

function fail(failures, message) {
  failures.push(message);
  console.error(`FAIL  ${message}`);
}

function ok(message) {
  console.log(`ok    ${message}`);
}

function note(message) {
  console.log(`note  ${message}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures = [];

  if (!fs.existsSync(args.buildDir)) {
    fail(failures, `build dir missing: ${args.buildDir}`);
    console.log('VERDICT: NOT LIVE');
    process.exit(1);
  }

  const built = walkBuild(args.buildDir);
  console.log(`build/  ${built.size} files`);

  let zipped = { ok: false, files: new Map(), error: 'skipped' };
  if (!args.skipZip) {
    zipped = loadZipManifest();
    if (!zipped.ok) fail(failures, `deploy.py --manifest failed: ${zipped.error}`);
    else ok(`zip manifest ${zipped.files.size} members`);
  }

  const htaccessPath = path.join(args.buildDir, '.htaccess');
  if (!fs.existsSync(htaccessPath)) {
    fail(failures, 'build/.htaccess missing (public/.htaccess owns DirectoryIndex, the UTF-8 charset and no COOP/COEP)');
  } else {
    const htaccessFailures = checkHtaccess(fs.readFileSync(htaccessPath, 'utf8'));
    for (const f of htaccessFailures) fail(failures, f);
    if (!htaccessFailures.length) ok('build/.htaccess: DirectoryIndex, UTF-8 charset, no COOP/COEP');
  }

  const builtIndexPath = path.join(args.buildDir, 'index.html');
  const builtIndexText = fs.existsSync(builtIndexPath)
    ? decodeHtml(fs.readFileSync(builtIndexPath), 'text/html; charset=utf-8').text
    : null;
  if (builtIndexText == null) fail(failures, 'build/index.html missing — cannot compare the live documents');

  const indexUrl = joinUrl(args.url, 'index.html');
  console.log(`\nFetching DIRECTORY URL  ${args.url}`);
  console.log('(not just index.html — that fetch is what hid the UTF-16 shadow)');
  console.log(`Fetching               ${indexUrl}`);
  let dir;
  let indexDoc;
  try {
    dir = await fetchBuf(args.url);
    indexDoc = await fetchBuf(indexUrl);
  } catch (err) {
    fail(failures, `directory URL / index.html fetch threw: ${err instanceof Error ? err.message : err}`);
    console.log('VERDICT: NOT LIVE');
    process.exit(1);
  }
  if (!dir.ok) fail(failures, `directory URL HTTP ${dir.status}`);
  if (!indexDoc.ok) fail(failures, `index.html HTTP ${indexDoc.status}`);

  for (const [name, res] of [['directory URL', dir], ['index.html', indexDoc]]) {
    console.log(`${name}  content-type=${JSON.stringify(res.contentType)} bytes=${res.buf.length} headerSize=${res.headerSize ?? 'n/a'}`);
  }

  const docs = checkDirectoryDocuments({ dir, index: indexDoc, builtIndexText });
  for (const f of docs.failures) fail(failures, f);
  for (const n of docs.notes) note(n);
  if (!docs.failures.length) {
    ok(`directory URL and index.html are the same UTF-8 document as build/index.html (${docs.directory.source})`);
  }
  for (const [name, res] of [['directory URL', dir], ['index.html', indexDoc]]) {
    const iso = checkIsolationHeaders(name, res);
    for (const f of iso.failures) fail(failures, f);
    for (const n of iso.notes) note(n);
  }

  // Everything below reads the directory URL's own document, decoded as a browser would.
  const htmlDec = docs.directory;

  const liveBuildId = parseBuildIdMeta(htmlDec.text);
  const localBuildIdPath = path.join(args.buildDir, 'BUILD_ID');
  const localBuildId = fs.existsSync(localBuildIdPath)
    ? fs.readFileSync(localBuildIdPath, 'utf8').trim()
    : null;
  if (!liveBuildId) {
    fail(failures, 'directory URL carries no <meta name="build-id">');
  } else if (!localBuildId) {
    fail(failures, 'build/BUILD_ID missing');
  } else if (liveBuildId !== localBuildId) {
    fail(failures, `build-id mismatch live=${liveBuildId} local=${localBuildId}`);
  } else {
    ok(`build-id matches ${liveBuildId}`);
  }

  const refs = parseAssetRefs(htmlDec.text);
  const entryRel = parseEntryScript(htmlDec.text);
  console.log(`directory named ${refs.length} src/href refs; entry=${entryRel || '(none)'}`);

  for (const ref of refs) {
    const abs = joinUrl(args.url, ref);
    const fromBuild = [...built.keys()].find((k) => abs.endsWith(k) || ref.replace(/^\.\//, '') === k);
    if (!fromBuild) {
      fail(failures, `asset the directory URL names is absent from build/: ${ref}`);
      continue;
    }
    let liveAsset;
    try {
      liveAsset = await fetchBuf(abs);
    } catch (err) {
      fail(failures, `asset fetch threw ${ref}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!liveAsset.ok) {
      fail(failures, `asset HTTP ${liveAsset.status}: ${ref}`);
      continue;
    }
    const local = built.get(fromBuild);
    if (liveAsset.buf.length !== local.size || sha256(liveAsset.buf) !== local.sha256) {
      fail(
        failures,
        `asset drift ${fromBuild}: live size=${liveAsset.buf.length} sha=${sha256(liveAsset.buf).slice(0, 12)} vs build size=${local.size} sha=${local.sha256.slice(0, 12)}`,
      );
    } else {
      ok(`asset ${fromBuild} size+sha256 match build/`);
    }
  }

  for (const name of ['watershed_native.js', 'watershed_native.wasm']) {
    const local = built.get(name);
    if (!local) {
      fail(failures, `build/ missing ${name}`);
      continue;
    }
    let liveNative;
    try {
      liveNative = await fetchBuf(joinUrl(args.url, name));
    } catch (err) {
      fail(failures, `${name} fetch threw: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!liveNative.ok) {
      fail(failures, `${name} HTTP ${liveNative.status}`);
      continue;
    }
    const liveSize = liveNative.buf.length;
    if (liveSize !== local.size) {
      fail(failures, `${name} size live=${liveSize} HEAD/build=${local.size}`);
    } else {
      ok(`${name} size ${liveSize} matches build/`);
    }
    if (sha256(liveNative.buf) !== local.sha256) {
      fail(failures, `${name} sha256 differs from build/`);
    }
  }

  const glue = built.get('watershed_native.js');
  const wasm = built.get('watershed_native.wasm');
  if (glue && wasm) {
    // Pair equality vs HEAD is the glue AND wasm both matching build/ — already
    // failed individually above. Call it out as a pair if either missed.
    const pairOk = !failures.some((f) => f.startsWith('watershed_native.js size') || f.startsWith('watershed_native.wasm size'));
    if (pairOk) ok('glue/wasm pair sizes both equal HEAD/build');
  }

  if (zipped.ok) {
    for (const [rel, info] of built) {
      const z = zipped.files.get(rel);
      if (z == null) {
        // hashed assets may be skipped when sizes match; unhashed must be in zip
        if (!rel.startsWith('assets/')) {
          fail(failures, `unhashed ${rel} in build/ but not in zip manifest`);
        }
      } else if (z !== info.size) {
        fail(failures, `zip size ${rel} zip=${z} build=${info.size}`);
      }
    }
  }

  if (entryRel) {
    const entryAbs = joinUrl(args.url, entryRel);
    let entry;
    try {
      entry = await fetchBuf(entryAbs);
    } catch (err) {
      fail(failures, `entry bundle fetch threw: ${err instanceof Error ? err.message : err}`);
      entry = null;
    }
    if (entry && entry.ok) {
      const text = entry.buf.toString('utf8');
      if (!text.includes('WasmInitTimeoutError')) {
        fail(failures, 'served entry bundle missing WasmInitTimeoutError');
      } else {
        ok('entry bundle contains WasmInitTimeoutError');
      }
      if (!text.includes('negotiateBootGraphics')) {
        fail(failures, 'served entry bundle missing negotiateBootGraphics');
      } else {
        ok('entry bundle contains negotiateBootGraphics');
      }
    } else if (entry) {
      fail(failures, `entry bundle HTTP ${entry.status}`);
    }
  } else {
    fail(failures, 'directory URL names no module entry script');
  }

  if (args.skipRender) {
    note('render check skipped (--skip-render)');
  } else {
    console.log(`\nRendering ${args.url} in headless Chrome`);
    const render = await renderCheck(args.url, builtIndexText == null ? null : parseTitle(builtIndexText));
    for (const f of render.failures) fail(failures, f);
    if (render.info && !render.failures.length) {
      ok(
        `render: characterSet=${render.info.characterSet} title=${JSON.stringify(render.info.title)} scripts=${render.info.scripts}`,
      );
    }
  }

  console.log('');
  if (failures.length) {
    console.log(`VERDICT: NOT LIVE  (${failures.length} check(s) failed)`);
    process.exit(1);
  }
  console.log(args.skipRender ? 'VERDICT: LIVE (render check skipped)' : 'VERDICT: LIVE');
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    console.log('VERDICT: NOT LIVE');
    process.exit(1);
  });
}
