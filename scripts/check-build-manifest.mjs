#!/usr/bin/env node
/**
 * Build-manifest guard — the unhashed-passenger contract.
 *
 * Vite content-hashes everything it emits into `build/assets/`, so those files
 * are self-verifying: different bytes mean a different filename. The rest of
 * `build/` is not. `index.html`, `BUILD_ID`, and every file copied verbatim out
 * of `public/` keep the same path forever, whatever their bytes say. That is the
 * exact class of file `deploy.py`'s size-only skip can serve stale
 * (docs/reference/DEPLOY_AUDIT.md §2, §5a), so it is the class worth asserting.
 *
 * Run after a build:
 *
 *   node scripts/check-build-manifest.mjs
 *   node scripts/check-build-manifest.mjs --manifest build-manifest.tsv
 *   node scripts/check-build-manifest.mjs --json
 *
 * Exits 0 when the contract holds, 1 with a per-violation report when it does not.
 * Standalone: no arguments, no env, no network, no dependency beyond node core.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(repoRoot, 'build');
const publicDir = join(repoRoot, 'public');

/* ------------------------------------------------------------------ contract */

/** Unhashed files Vite generates itself, rather than copying from `public/`. */
const GENERATED_UNHASHED = new Set(['index.html', 'BUILD_ID']);

/**
 * `public/index.html` is NOT a passenger: Vite's own generated `index.html`
 * (from the repo-root `index.html` template) is written to the same path and
 * wins. It is listed here so the guard reports it as shadowed rather than as a
 * missing passenger.
 */
const SHADOWED_PUBLIC = new Set(['index.html']);

/**
 * Expected passenger count, asserted so that adding or deleting a `public/`
 * file is a deliberate act with a diff attached rather than a silent change in
 * what the deploy ships. Bump this in the same commit that changes `public/`.
 *
 * 37 = 6 Rock031_* textures + collision.wav + 4 levels/* + rapier.wasm
 *      + 23 sounds/*.mp3 + watershed_native.js + watershed_native.wasm
 */
const EXPECTED_PASSENGER_COUNT = 37;

/** Paths whose bytes must be produced by one and the same emcc invocation. */
const COUPLED_PAIRS = [['watershed_native.js', 'watershed_native.wasm']];

/**
 * Directories the build must NOT emit. `shaders/` held four `.wgsl` files that
 * nothing in the tree generates any more; four of them are still orphaned on
 * the deploy target because `deploy.py` has no delete path (DEPLOY_AUDIT §3).
 * Asserting their absence locally is what stops a fifth from joining them.
 */
const FORBIDDEN_BUILD_DIRS = ['shaders'];

/** Rollup's default content hash: exactly 8 base64url characters. */
const HASHED_ASSET = /^assets\/.+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/* --------------------------------------------------------------------- utils */

function walk(root) {
  if (!existsSync(root)) return null;
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join(posix.sep));
    }
  };
  visit(root);
  return out;
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const failures = [];
const fail = (message) => failures.push(message);

/* ------------------------------------------------------------------- collect */

const buildFiles = walk(buildDir);
const publicFiles = walk(publicDir);

if (buildFiles === null) {
  console.error('check-build-manifest: no build/ directory. Run `pnpm build` first.');
  process.exit(1);
}
if (publicFiles === null) {
  console.error('check-build-manifest: no public/ directory — cannot verify passengers.');
  process.exit(1);
}

const passengers = publicFiles.filter((p) => !SHADOWED_PUBLIC.has(p));
const manifest = buildFiles.map((rel) => {
  const full = join(buildDir, rel);
  const hashed = HASHED_ASSET.test(rel);
  return {
    path: rel,
    bytes: statSync(full).size,
    sha256: sha256(full),
    hashed,
    kind: hashed
      ? 'hashed-asset'
      : GENERATED_UNHASHED.has(rel)
        ? 'generated-unhashed'
        : 'passenger',
  };
});
const byPath = new Map(manifest.map((e) => [e.path, e]));

/* ------------------------------------------------------------------- asserts */

// 1. Every public/ passenger arrives, byte-identical.
for (const rel of passengers) {
  const entry = byPath.get(rel);
  if (!entry) {
    fail(`passenger missing from build/: ${rel}`);
    continue;
  }
  const source = sha256(join(publicDir, rel));
  if (source !== entry.sha256) {
    fail(`passenger differs from public/ source: ${rel}\n    public/ ${source}\n    build/  ${entry.sha256}`);
  }
}

// 2. The passenger set is exactly what is declared — no strays either way.
const declared = new Set(passengers);
for (const entry of manifest) {
  if (entry.kind === 'passenger' && !declared.has(entry.path)) {
    fail(`unhashed file in build/ with no public/ source and no generated-file carve-out: ${entry.path}`);
  }
}
if (passengers.length !== EXPECTED_PASSENGER_COUNT) {
  fail(
    `passenger count is ${passengers.length}, contract declares ${EXPECTED_PASSENGER_COUNT}. ` +
      'If public/ changed on purpose, update EXPECTED_PASSENGER_COUNT in this file in the same commit.',
  );
}

// 3. Generated unhashed files are present.
for (const rel of GENERATED_UNHASHED) {
  if (!byPath.has(rel)) fail(`generated unhashed file missing from build/: ${rel}`);
}

// 4. The emcc pair is coherent: both halves present, both matching public/.
for (const pair of COUPLED_PAIRS) {
  const present = pair.filter((p) => byPath.has(p));
  if (present.length !== 0 && present.length !== pair.length) {
    fail(`coupled artifact pair is half-shipped: have [${present}], expected [${pair}]`);
  }
}

// 5. index.html points only at files that actually exist, and each is hashed.
const indexHtml = byPath.has('index.html')
  ? readFileSync(join(buildDir, 'index.html'), 'utf8')
  : '';
const referenced = [...indexHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
if (byPath.has('index.html') && referenced.length === 0) {
  fail('build/index.html references no ./assets/* file — the entry graph is not wired.');
}
for (const ref of referenced) {
  if (!byPath.has(ref)) fail(`index.html references a file that is not in build/: ${ref}`);
  else if (!HASHED_ASSET.test(ref)) fail(`index.html references an unhashed entry file: ${ref}`);
}

// 6. Dead directories stay dead.
for (const dir of FORBIDDEN_BUILD_DIRS) {
  const hits = buildFiles.filter((p) => p.startsWith(`${dir}/`));
  if (hits.length > 0) {
    fail(`build/${dir}/ should not exist, found ${hits.length} file(s): ${hits.join(', ')}`);
  }
}

/* -------------------------------------------------------------------- output */

const manifestArg = process.argv.indexOf('--manifest');
if (manifestArg !== -1 && process.argv[manifestArg + 1]) {
  const dest = process.argv[manifestArg + 1];
  const tsv = ['path\tbytes\tsha256\thashed\tkind']
    .concat(manifest.map((e) => [e.path, e.bytes, e.sha256, e.hashed, e.kind].join('\t')))
    .join('\n');
  writeFileSync(dest, `${tsv}\n`, 'utf8');
  console.log(`check-build-manifest: wrote ${manifest.length} rows to ${dest}`);
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: failures.length === 0, failures, manifest }, null, 2));
}

const hashedCount = manifest.filter((e) => e.hashed).length;
const totalBytes = manifest.reduce((n, e) => n + e.bytes, 0);

if (failures.length > 0) {
  console.error('check-build-manifest: FAILED\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    `\n${failures.length} violation(s). See docs/reference/BUILD_HYGIENE.md for the contract.`,
  );
  process.exit(1);
}

console.log(
  `check-build-manifest: OK — ${manifest.length} files, ${hashedCount} content-hashed, ` +
    `${passengers.length} passengers byte-identical to public/, ` +
    `${GENERATED_UNHASHED.size} generated unhashed, ${(totalBytes / 1e6).toFixed(1)} MB total.`,
);
