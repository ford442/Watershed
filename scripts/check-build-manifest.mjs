#!/usr/bin/env node
/**
 * check-build-manifest.mjs — the unhashed-passenger contract guard.
 *
 * Vite content-hashes everything in build/assets/ with an 8-char Rollup hash, so
 * those files are self-verifying: changed bytes mean a changed filename. The rest
 * of build/ is NOT hashed — index.html, BUILD_ID, and the files copied verbatim
 * from public/. Their identity on disk never changes even when their bytes do,
 * which is the exact class of file that let this project's deploy serve an
 * incoherent build for over a month (see docs/reference/DEPLOY_AUDIT.md).
 *
 * This script asserts the contract those unhashed files must satisfy after a
 * build, and can emit a full manifest (path, size, sha256, hashed flag).
 *
 * Usage (standalone, no build step, no package.json entry required):
 *   node scripts/check-build-manifest.mjs
 *   node scripts/check-build-manifest.mjs --manifest
 *   node scripts/check-build-manifest.mjs --json build-manifest.json
 *   node scripts/check-build-manifest.mjs --build-dir build --public-dir public
 *
 * Exit codes: 0 = contract holds, 1 = contract violated, 2 = could not run
 * (missing build directory, bad arguments).
 *
 * This guard REPORTS. It never writes into build/ and never mutates sources.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Writing a long manifest into `| head` closes stdout early; that is a normal
 * way to use this script, not a crash. */
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  throw err;
});

/* ------------------------------------------------------------------ *
 * Declared inventory.
 *
 * Deliberately pinned rather than derived, so that ADDING or REMOVING a
 * public/ passenger is a decision someone records here, not a silent drift.
 * If you legitimately add an asset to public/, add it here in the same commit.
 * ------------------------------------------------------------------ */
const EXPECTED_PASSENGERS = [
  'Rock031.png',
  'Rock031_1K-JPG_AmbientOcclusion.jpg',
  'Rock031_1K-JPG_Color.jpg',
  'Rock031_1K-JPG_Displacement.jpg',
  'Rock031_1K-JPG_NormalGL.jpg',
  'Rock031_1K-JPG_Roughness.jpg',
  'collision.wav',
  'levels/README.md',
  'levels/autumn-rapids.json',
  'levels/devils-gorge.json',
  'levels/gentle-creek.json',
  'rapier.wasm',
  'sounds/ambient_canyon.mp3',
  'sounds/ambient_water.mp3',
  'sounds/ambient_wind.mp3',
  'sounds/boost.mp3',
  'sounds/collide_concrete.mp3',
  'sounds/collide_moss.mp3',
  'sounds/collide_rock.mp3',
  'sounds/collide_wood.mp3',
  'sounds/footstep_moss.mp3',
  'sounds/footstep_rock.mp3',
  'sounds/footstep_wet.mp3',
  'sounds/footstep_wood.mp3',
  'sounds/jump.mp3',
  'sounds/jump_double.mp3',
  'sounds/land_hard.mp3',
  'sounds/land_impact.mp3',
  'sounds/land_soft.mp3',
  'sounds/paddle_left.mp3',
  'sounds/paddle_right.mp3',
  'sounds/raft_creak.mp3',
  'sounds/rapids_roar.mp3',
  'sounds/splash.mp3',
  'sounds/water_crash.mp3',
  'watershed_native.js',
  'watershed_native.wasm',
];

/** public/ files that must NOT be copied through to build/ as-is.
 *  public/index.html is a stale, script-less duplicate of the root index.html
 *  template. Vite copies publicDir first and then writes the generated
 *  index.html over it, so the generated one wins today — but if that ordering
 *  ever changes, the deploy silently serves a blank page. Guard the outcome. */
const PASSENGER_EXCLUDED = new Set(['index.html']);

/** Unhashed files build/ is allowed to contain besides the passengers. */
const EXPECTED_GENERATED_UNHASHED = ['index.html', 'BUILD_ID'];

/** Retired asset lanes. Their presence means a stale tree or a resurrected
 *  dead file. The WGSL compute lane was retired with #256 path B; src/shaders/
 *  no longer exists and nothing fetches a .wgsl at runtime. */
const RETIRED_PATHS = ['shaders'];

/** The emcc pair. build.sh stamps sha256(js || wasm)[0:16] into
 *  wasmArtifactStamp.ts, which is the proof the two came from one invocation. */
const NATIVE_JS = 'watershed_native.js';
const NATIVE_WASM = 'watershed_native.wasm';
const STAMP_SOURCE = 'src/systems/water/wasmArtifactStamp.ts';

const HASHED_RE = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = { buildDir: 'build', publicDir: 'public', manifest: false, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--build-dir') opts.buildDir = next();
    else if (arg === '--public-dir') opts.publicDir = next();
    else if (arg === '--manifest') opts.manifest = true;
    else if (arg === '--json') opts.json = next();
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  return opts;
}

const HELP = `check-build-manifest.mjs — assert the unhashed-passenger contract

  --build-dir <dir>   build output to check      (default: build)
  --public-dir <dir>  passenger sources          (default: public)
  --manifest          print the full manifest to stdout
  --json <file>       write the manifest as JSON
  -h, --help          this text

Exit 0 contract holds | 1 violated | 2 cannot run
`;

function fail(message) {
  process.stderr.write(`check-build-manifest: ${message}\n`);
  process.exit(2);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/* ------------------------------------------------------------------ */

const opts = parseArgs(process.argv.slice(2));
const buildDir = path.resolve(REPO_ROOT, opts.buildDir);
const publicDir = path.resolve(REPO_ROOT, opts.publicDir);

if (!fs.existsSync(buildDir)) {
  fail(`build directory not found: ${buildDir}\n  run \`pnpm build\` first, or pass --build-dir`);
}
if (!fs.existsSync(path.join(buildDir, 'assets'))) {
  fail(`${opts.buildDir}/assets/ not found — that is not a Vite build output`);
}

const failures = [];
const notes = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/* --- manifest ----------------------------------------------------- */

const buildFiles = walk(buildDir);
const manifest = buildFiles.map((rel) => {
  const abs = path.join(buildDir, rel);
  const hashed = rel.startsWith('assets/') && HASHED_RE.test(rel);
  return { path: rel, size: fs.statSync(abs).size, sha256: sha256(abs), hashed };
});
const byPath = new Map(manifest.map((e) => [e.path, e]));
const unhashed = manifest.filter((e) => !e.hashed);

/* --- 1. index.html is the GENERATED one, not the public duplicate --- */

const indexEntry = byPath.get('index.html');
if (!indexEntry) {
  failures.push('build/index.html is missing');
} else {
  const html = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8');
  check(
    /<script type="module"[^>]*src="\.\/assets\//.test(html),
    'build/index.html has no hashed module entry script — it looks like the stale\n' +
      '    public/index.html passenger copied over the generated file. Serving this\n' +
      '    would give every player a blank page.',
  );
  check(
    !html.includes('__WATERSHED_BUILD_ID__'),
    'build/index.html still contains the literal __WATERSHED_BUILD_ID__ placeholder —\n' +
      '    the build-identity plugin did not run.',
  );
  const buildIdMeta = html.match(/<meta name="build-id" content="([^"]*)"/);
  check(buildIdMeta !== null, 'build/index.html has no <meta name="build-id"> element');

  /* index.html references hashed assets by exact name; every one must exist. */
  const referenced = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
  check(referenced.length > 0, 'build/index.html references no assets/ files at all');
  for (const ref of referenced) {
    check(byPath.has(ref), `build/index.html references ${ref}, which is not in the build`);
  }
  notes.push(`index.html: ${indexEntry.size} bytes, references ${referenced.length} hashed files`);

  /* BUILD_ID must agree with the meta tag, or the deploy cannot be identified. */
  const buildIdFile = path.join(buildDir, 'BUILD_ID');
  if (!fs.existsSync(buildIdFile)) {
    failures.push('build/BUILD_ID is missing — the build-identity plugin did not write it');
  } else if (buildIdMeta) {
    const fileId = fs.readFileSync(buildIdFile, 'utf8').trim();
    check(
      fileId === buildIdMeta[1],
      `build/BUILD_ID (${fileId}) disagrees with index.html's build-id meta ` +
        `(${buildIdMeta[1]}) — the two halves came from different builds`,
    );
  }
}

/* --- 2. passenger inventory matches public/ ----------------------- */

if (!fs.existsSync(publicDir)) {
  failures.push(`public directory not found: ${publicDir} — cannot verify passengers`);
} else {
  const actualPublic = walk(publicDir).filter((f) => !PASSENGER_EXCLUDED.has(f));
  const expected = new Set(EXPECTED_PASSENGERS);
  for (const f of actualPublic) {
    check(
      expected.has(f),
      `public/${f} is a passenger the guard does not know about. If it is intended, ` +
        'add it to EXPECTED_PASSENGERS in this script.',
    );
  }
  for (const f of EXPECTED_PASSENGERS) {
    check(actualPublic.includes(f), `expected passenger public/${f} is missing from public/`);
  }

  /* --- 3. each passenger arrives byte-identical -------------------- */
  let identical = 0;
  for (const rel of actualPublic) {
    const built = byPath.get(rel);
    if (!built) {
      failures.push(`passenger public/${rel} did not arrive in ${opts.buildDir}/${rel}`);
      continue;
    }
    const srcSha = sha256(path.join(publicDir, rel));
    if (srcSha !== built.sha256) {
      failures.push(
        `passenger ${rel} is NOT byte-identical to its public/ source\n` +
          `    public/: ${srcSha}\n    build/ : ${built.sha256}`,
      );
    } else identical += 1;
    check(!built.hashed, `passenger ${rel} unexpectedly carries a content hash`);
  }
  notes.push(`passengers: ${identical}/${actualPublic.length} byte-identical to public/`);

  /* --- 4. public/index.html must not have won ---------------------- */
  const strayIndex = path.join(publicDir, 'index.html');
  if (fs.existsSync(strayIndex) && indexEntry) {
    check(
      sha256(strayIndex) !== indexEntry.sha256,
      'build/index.html is byte-identical to public/index.html — the stale passenger ' +
        'overwrote the generated entry document.',
    );
    notes.push(
      'warning: public/index.html exists and is a script-less duplicate of the root ' +
        'template; it is shadowed by the generated file, not needed, and a hazard.',
    );
  }
}

/* --- 5. the emcc pair came from one invocation -------------------- */

const nativeJs = byPath.get(NATIVE_JS);
const nativeWasm = byPath.get(NATIVE_WASM);
if (!nativeJs || !nativeWasm) {
  failures.push(`the native WASM pair is incomplete in ${opts.buildDir}/ ` +
    `(${NATIVE_JS}: ${nativeJs ? 'present' : 'MISSING'}, ` +
    `${NATIVE_WASM}: ${nativeWasm ? 'present' : 'MISSING'})`);
} else {
  const pairStamp = createHash('sha256')
    .update(fs.readFileSync(path.join(buildDir, NATIVE_JS)))
    .update(fs.readFileSync(path.join(buildDir, NATIVE_WASM)))
    .digest('hex')
    .slice(0, 16);

  const stampFile = path.resolve(REPO_ROOT, STAMP_SOURCE);
  if (!fs.existsSync(stampFile)) {
    failures.push(`${STAMP_SOURCE} is missing — cannot verify the emcc pair`);
  } else {
    const declared = fs.readFileSync(stampFile, 'utf8').match(/WASM_ARTIFACT_STAMP = '([^']+)'/);
    if (!declared) {
      failures.push(`${STAMP_SOURCE} does not declare WASM_ARTIFACT_STAMP`);
    } else {
      check(
        declared[1] === pairStamp,
        `the shipped ${NATIVE_JS}/${NATIVE_WASM} pair does not match the artifact stamp\n` +
          `    ${STAMP_SOURCE}: ${declared[1]}\n` +
          `    sha256(js||wasm)[0:16]: ${pairStamp}\n` +
          '    The .js and .wasm are from different emcc invocations, or the stamp is stale.\n' +
          '    Re-run `pnpm build:wasm`.',
      );
      notes.push(`emcc pair stamp: ${pairStamp} (matches ${STAMP_SOURCE})`);

      /* BUILD_ID embeds the stamp; if it disagrees, the JS bundle was compiled
       * against a different WASM than the one being shipped beside it. */
      const buildIdFile = path.join(buildDir, 'BUILD_ID');
      if (fs.existsSync(buildIdFile)) {
        const parts = fs.readFileSync(buildIdFile, 'utf8').trim().split(/\s+/);
        if (parts.length >= 2 && parts[1] !== 'unknown') {
          check(
            parts[1] === pairStamp,
            `build/BUILD_ID records WASM stamp ${parts[1]} but the shipped pair hashes to ` +
              `${pairStamp} — the bundle and the WASM beside it are from different builds`,
          );
        }
      }
    }
  }

  check(
    fs.readFileSync(path.join(buildDir, NATIVE_JS), 'utf8').includes(`"${NATIVE_WASM}"`),
    `${NATIVE_JS} does not reference "${NATIVE_WASM}" — the loader glue and the module ` +
      'binary are not a matched pair',
  );
}

/* --- 6. retired lanes stay retired -------------------------------- */

for (const rel of RETIRED_PATHS) {
  check(
    !fs.existsSync(path.join(buildDir, rel)),
    `${opts.buildDir}/${rel}/ exists but that asset lane is retired — stale output tree, ` +
      'or a dead file was resurrected. Remove it rather than deploying it.',
  );
  check(
    !fs.existsSync(path.join(publicDir, rel)),
    `${opts.publicDir}/${rel}/ exists but that asset lane is retired.`,
  );
}

/* --- 7. no unknown unhashed file in build/ ------------------------ */

const allowedUnhashed = new Set([...EXPECTED_GENERATED_UNHASHED, ...EXPECTED_PASSENGERS]);
for (const entry of unhashed) {
  check(
    allowedUnhashed.has(entry.path),
    `${opts.buildDir}/${entry.path} is unhashed and unaccounted for. Every unhashed file ` +
      'is deploy-invisible: its name never changes when its bytes do. Either give it a ' +
      'content hash or declare it in this script.',
  );
}

/* --- 8. every assets/ file is hashed ------------------------------ */

for (const entry of manifest) {
  if (!entry.path.startsWith('assets/')) continue;
  check(
    entry.hashed,
    `${opts.buildDir}/${entry.path} lives in assets/ but has no 8-char content hash`,
  );
}

/* ------------------------------------------------------------------ */

const hashedCount = manifest.length - unhashed.length;

if (opts.manifest) {
  process.stdout.write('\nMANIFEST\n');
  process.stdout.write(`${'HASH?'.padEnd(6)}${'SIZE'.padStart(10)}  ${'SHA256'.padEnd(16)}  PATH\n`);
  for (const e of manifest) {
    process.stdout.write(
      `${(e.hashed ? 'hashed' : 'UNHASH').padEnd(6)}${String(e.size).padStart(10)}  ` +
        `${e.sha256.slice(0, 16)}  ${e.path}\n`,
    );
  }
}

if (opts.json) {
  const out = path.resolve(process.cwd(), opts.json);
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        buildDir: opts.buildDir,
        totals: {
          files: manifest.length,
          hashed: hashedCount,
          unhashed: unhashed.length,
          bytes: manifest.reduce((n, e) => n + e.size, 0),
        },
        files: manifest,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write(`\nmanifest JSON written to ${out}\n`);
}

process.stdout.write(
  `\ncheck-build-manifest: ${manifest.length} files ` +
    `(${hashedCount} hashed, ${unhashed.length} unhashed)\n`,
);
for (const note of notes) process.stdout.write(`  note: ${note}\n`);

if (failures.length > 0) {
  process.stdout.write(`\nFAIL — ${failures.length} contract violation(s):\n`);
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}

process.stdout.write('\nPASS — unhashed-passenger contract holds.\n');
