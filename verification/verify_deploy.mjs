#!/usr/bin/env node
/**
 * Three-way deploy verifier: local build/ vs deploy.py zip vs LIVE DIRECTORY URL.
 *
 * The load-bearing fetch is the directory URL (…/watershed/), NOT index.html.
 * Fetching index.html is what hid the UTF-16 DirectoryIndex shadow for a month.
 *
 * Usage:
 *   node verification/verify_deploy.mjs
 *   node verification/verify_deploy.mjs --url http://127.0.0.1:4179/
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
  const out = { url: DEFAULT_LIVE, buildDir: path.join(REPO_ROOT, 'build'), skipZip: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--build-dir') out.buildDir = path.resolve(argv[++i]);
    else if (a === '--skip-zip') out.skipZip = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node verification/verify_deploy.mjs [--url <directory-url>] [--build-dir build] [--skip-zip]');
      process.exit(0);
    }
  }
  if (!out.url.endsWith('/')) out.url += '/';
  return out;
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function decodeHtml(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: 'utf-16le', text: buf.slice(2).toString('utf16le') };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: 'utf-16be', text: buf.swap16().slice(2).toString('utf16le') };
  }
  return { encoding: 'utf-8', text: buf.toString('utf8') };
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
  return { ok: res.ok, status: res.status, buf, headerSize, url: res.url };
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

  console.log(`\nFetching DIRECTORY URL  ${args.url}`);
  console.log('(not index.html — that fetch is what hid the UTF-16 shadow)');
  let dir;
  try {
    dir = await fetchBuf(args.url);
  } catch (err) {
    fail(failures, `directory URL fetch threw: ${err instanceof Error ? err.message : err}`);
    console.log('VERDICT: NOT LIVE');
    process.exit(1);
  }
  if (!dir.ok) fail(failures, `directory URL HTTP ${dir.status}`);

  const htmlDec = decodeHtml(dir.buf);
  console.log(`directory encoding=${htmlDec.encoding} bytes=${dir.buf.length} headerSize=${dir.headerSize ?? 'n/a'}`);
  if (htmlDec.encoding !== 'utf-8') {
    fail(failures, `directory URL is not UTF-8 (got ${htmlDec.encoding}, ${dir.buf.length} bytes)`);
  } else {
    ok('directory URL is UTF-8');
  }

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

  console.log('');
  if (failures.length) {
    console.log(`VERDICT: NOT LIVE  (${failures.length} check(s) failed)`);
    process.exit(1);
  }
  console.log('VERDICT: LIVE');
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
