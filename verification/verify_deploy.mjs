#!/usr/bin/env node
/**
 * verify_deploy.mjs — answer "is HEAD live?" from outside the browser.
 *
 * Usage:
 *   node verification/verify_deploy.mjs [baseUrl] [--expect <sha>] [--json]
 *   pnpm verify:deploy
 *
 * Default baseUrl: https://test.1ink.us/watershed/ (the deploy target).
 *
 * What it does, over plain fetch — no dependencies, no browser:
 *   1. GET  build-identity.json          → what the server claims to be serving
 *   2. GET  index.html, resolve every asset it references → all must be 200
 *   3. HEAD watershed_native.js / .wasm  → byte lengths must equal the identity's
 *   4. --expect <sha>                    → identity.commit must match (short or full)
 *
 * Prints a single VERDICT line. Exits non-zero on any mismatch, so it is safe to
 * chain after a deploy (build_and_patch.py does exactly that).
 *
 * This is the check that was missing when #402 went live: the served bytes had
 * never once been compared to the built bytes.
 */

export const DEFAULT_BASE_URL = 'https://test.1ink.us/watershed/';
export const BUILD_IDENTITY_FILENAME = 'build-identity.json';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in verify_deploy.test.mjs — no network there)
// ---------------------------------------------------------------------------

/** Normalise a base URL to a directory form ending in exactly one slash. */
export function normalizeBaseUrl(base) {
  const raw = String(base ?? '').trim() || DEFAULT_BASE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
}

/** Parse argv into options. Pure. */
export function parseArgs(argv) {
  const options = { baseUrl: DEFAULT_BASE_URL, expect: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--expect') {
      options.expect = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--expect=')) {
      options.expect = arg.slice('--expect='.length);
    } else if (arg === '--json') {
      options.json = true;
    } else if (!arg.startsWith('-')) {
      options.baseUrl = arg;
    }
  }
  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  return options;
}

/**
 * Extract every local asset URL referenced by an index.html: script src, link
 * href, and modulepreload. External (http/data) references are ignored — this
 * checks what the deploy is responsible for.
 */
export function extractAssetRefs(html) {
  const refs = new Set();
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const ref = match[1].trim();
    if (!ref || ref.startsWith('#') || ref.startsWith('data:')) continue;
    if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith('//')) continue;
    refs.add(ref.replace(/^\.\//, ''));
  }
  return [...refs];
}

/** True when `expected` (short or full sha) identifies the same commit as `actual`. */
export function commitMatches(actual, expected) {
  if (!expected) return true;
  if (!actual || actual === 'unknown') return false;
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  return a === e || a.startsWith(e) || e.startsWith(a);
}

/**
 * Turn gathered evidence into a verdict. Pure — the network layer hands it
 * plain data so this is fully unit-testable.
 *
 * @param {object} evidence
 *   identity   — parsed build-identity.json, or null when it could not be fetched
 *   assets     — [{ url, status }]
 *   passengers — [{ file, expectedBytes, actualBytes }]
 *   expect     — commit the caller asserted, or null
 * @returns {{ ok: boolean, failures: string[], verdict: string }}
 */
export function evaluate({ identity, assets = [], passengers = [], expect = null } = {}) {
  const failures = [];

  if (!identity) {
    failures.push(
      `${BUILD_IDENTITY_FILENAME} is missing or unparsable — the server is running a build `
      + 'that predates build identity (i.e. NOT this code).',
    );
  }

  for (const asset of assets) {
    if (asset.status !== 200) {
      failures.push(`asset ${asset.url} → HTTP ${asset.status}`);
    }
  }

  for (const passenger of passengers) {
    if (passenger.expectedBytes <= 0) continue;
    if (passenger.actualBytes == null) {
      failures.push(`${passenger.file} could not be measured`);
      continue;
    }
    if (passenger.actualBytes !== passenger.expectedBytes) {
      failures.push(
        `${passenger.file} served ${passenger.actualBytes}B but the identity records `
        + `${passenger.expectedBytes}B — SPLIT PROVENANCE`,
      );
    }
  }

  if (expect && !commitMatches(identity?.commit, expect)) {
    failures.push(`expected commit ${expect} but the server is serving ${identity?.commit ?? 'unknown'}`);
  }

  if (identity?.dirty) {
    failures.push('the live build was made from a dirty working tree — it matches no commit');
  }

  const ok = failures.length === 0;
  const shortSha = identity?.commitShort ?? 'unknown';
  const verdict = ok
    ? `VERDICT: LIVE — commit=${shortSha} stamp=${identity?.wasmStamp ?? 'unknown'} `
      + `glue=${identity?.glueBytes ?? 0}B wasm=${identity?.wasmBytes ?? 0}B `
      + `builtAt=${identity?.builtAt ?? 'unknown'} (${assets.length} assets 200)`
    : `VERDICT: NOT LIVE — ${failures.length} problem(s): ${failures[0]}`;

  return { ok, failures, verdict };
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

async function fetchJson(url, fetchImpl) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

async function fetchStatus(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { method: 'GET' });
    return response.status;
  } catch {
    return 0;
  }
}

/** True when a response body is stored as-is (no gzip/br/deflate on the wire). */
export function isIdentityEncoding(contentEncoding) {
  if (contentEncoding == null || contentEncoding === '') return true;
  return String(contentEncoding).trim().toLowerCase() === 'identity';
}

/**
 * Byte length of the RESOURCE, not of the response body.
 *
 * The deploy target gzips .js and .wasm, so `content-length` on an encoded
 * response is the compressed size (16146 for a 33817 B wasm) — comparing that to
 * a recorded size would report a mismatch on a perfectly good deploy. Only trust
 * content-length when the response is identity-encoded; otherwise let fetch decode
 * the body and measure that.
 */
async function fetchByteLength(url, fetchImpl) {
  try {
    const head = await fetchImpl(url, {
      method: 'HEAD',
      headers: { 'accept-encoding': 'identity' },
    });
    const encoding = head.headers?.get?.('content-encoding');
    const len = head.headers?.get?.('content-length');
    if (isIdentityEncoding(encoding) && len != null && len !== '') {
      const parsed = Number(len);
      if (Number.isFinite(parsed)) return parsed;
    }
    const body = await fetchImpl(url);
    return (await body.arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

/** Gather evidence from a live server and evaluate it. */
export async function verifyDeploy({ baseUrl, expect = null, fetchImpl = fetch, log = () => {} } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  log(`Verifying ${base}`);

  const identity = await fetchJson(new URL(BUILD_IDENTITY_FILENAME, base).href, fetchImpl);
  log(identity
    ? `  identity: commit=${identity.commitShort} stamp=${identity.wasmStamp} `
      + `glue=${identity.glueBytes}B wasm=${identity.wasmBytes}B builtAt=${identity.builtAt}`
    : `  identity: MISSING (${BUILD_IDENTITY_FILENAME} not served)`);

  let assets = [];
  try {
    const indexResponse = await fetchImpl(new URL('index.html', base).href);
    const html = await indexResponse.text();
    if (indexResponse.status !== 200) {
      assets = [{ url: new URL('index.html', base).href, status: indexResponse.status }];
    } else {
      const refs = extractAssetRefs(html);
      assets = await Promise.all(refs.map(async (ref) => {
        const url = new URL(ref, base).href;
        return { url, status: await fetchStatus(url, fetchImpl) };
      }));
      for (const asset of assets) {
        log(`  asset ${asset.status === 200 ? 'ok ' : 'BAD'} ${asset.status} ${asset.url}`);
      }
    }
  } catch (error) {
    assets = [{ url: new URL('index.html', base).href, status: 0 }];
    log(`  index.html: unreachable (${error.message})`);
  }

  const passengerSpecs = [
    { file: identity?.glueFile ?? 'watershed_native.js', expectedBytes: identity?.glueBytes ?? 0 },
    { file: identity?.wasmFile ?? 'watershed_native.wasm', expectedBytes: identity?.wasmBytes ?? 0 },
  ];
  const passengers = await Promise.all(passengerSpecs.map(async (spec) => {
    const actualBytes = await fetchByteLength(new URL(spec.file, base).href, fetchImpl);
    log(`  ${spec.file}: served ${actualBytes ?? 'unknown'}B, identity says ${spec.expectedBytes || 'unknown'}B`);
    return { ...spec, actualBytes };
  }));

  return { base, identity, assets, passengers, ...evaluate({ identity, assets, passengers, expect }) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const result = await verifyDeploy({
    baseUrl: options.baseUrl,
    expect: options.expect,
    log: options.json ? () => {} : (line) => console.log(line),
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const failure of result.failures) console.log(`  ✗ ${failure}`);
    console.log(result.verdict);
  }
  process.exit(result.ok ? 0 : 1);
}
