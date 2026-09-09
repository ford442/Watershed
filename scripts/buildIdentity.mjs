#!/usr/bin/env node
/**
 * Build identity resolution — the single source of truth for "which commit is this?".
 *
 * Consumed by:
 *   - vite.config.ts   → injects the identity as `__WATERSHED_BUILD_IDENTITY__` AND
 *                        emits the same object as `build/build-identity.json`
 *   - deploy.py        → (via the emitted JSON) refuses an incoherent build/
 *   - verification/verify_deploy.mjs → compares served bytes against the identity
 *
 * Both browser and static-JSON copies come from ONE call to `resolveBuildIdentity()`
 * per build. No second computation, no second copy.
 *
 * Everything here degrades to `"unknown"` rather than throwing: a CI tarball or a
 * Colab checkout with no .git must still produce a build.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILD_IDENTITY_FILENAME = 'build-identity.json';
export const BUILD_IDENTITY_SCHEMA = 1;
export const UNKNOWN = 'unknown';

/** Unhashed passengers copied verbatim from public/ — the files that drifted in #402. */
export const GLUE_FILE = 'watershed_native.js';
export const WASM_FILE = 'watershed_native.wasm';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Extract WASM_ARTIFACT_STAMP from the generated TS module. Pure — takes source text. */
export function parseArtifactStamp(source) {
  const match = /WASM_ARTIFACT_STAMP\s*=\s*['"]([0-9a-f]+)['"]/i.exec(String(source ?? ''));
  return match ? match[1] : UNKNOWN;
}

/** Byte size of a file, or 0 when it is absent (never throws). */
export function fileBytes(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * Current git state, or unknown/false when git is unavailable (tarball, Colab).
 * `dirty` is true when the working tree has uncommitted tracked changes.
 */
export function resolveGitState(repoRoot = REPO_ROOT) {
  try {
    const commit = git(repoRoot, ['rev-parse', 'HEAD']);
    const commitShort = git(repoRoot, ['rev-parse', '--short', 'HEAD']);
    const status = git(repoRoot, ['status', '--porcelain', '--untracked-files=no']);
    return { commit, commitShort, dirty: status.length > 0 };
  } catch {
    return { commit: UNKNOWN, commitShort: UNKNOWN, dirty: false };
  }
}

/**
 * Assemble the identity from already-gathered parts. Pure: no fs, no git, no clock.
 * Exported separately so unit tests can pin every input.
 */
export function makeBuildIdentity({
  commit = UNKNOWN,
  commitShort = UNKNOWN,
  dirty = false,
  builtAt,
  wasmStamp = UNKNOWN,
  glueBytes = 0,
  wasmBytes = 0,
} = {}) {
  return {
    schema: BUILD_IDENTITY_SCHEMA,
    commit: commit || UNKNOWN,
    commitShort: commitShort || UNKNOWN,
    dirty: Boolean(dirty),
    builtAt: builtAt || new Date(0).toISOString(),
    wasmStamp: wasmStamp || UNKNOWN,
    glueFile: GLUE_FILE,
    wasmFile: WASM_FILE,
    glueBytes: Number.isFinite(glueBytes) ? Number(glueBytes) : 0,
    wasmBytes: Number.isFinite(wasmBytes) ? Number(wasmBytes) : 0,
  };
}

/** Resolve the identity of the tree at `repoRoot` (reads git + public/ + the stamp). */
export function resolveBuildIdentity({ repoRoot = REPO_ROOT, now = () => new Date() } = {}) {
  const publicDir = join(repoRoot, 'public');
  let stampSource = '';
  try {
    stampSource = readFileSync(join(repoRoot, 'src/systems/water/wasmArtifactStamp.ts'), 'utf8');
  } catch {
    stampSource = '';
  }
  const gitState = resolveGitState(repoRoot);
  return makeBuildIdentity({
    ...gitState,
    builtAt: now().toISOString(),
    wasmStamp: parseArtifactStamp(stampSource),
    glueBytes: fileBytes(join(publicDir, GLUE_FILE)),
    wasmBytes: fileBytes(join(publicDir, WASM_FILE)),
  });
}

/** One-line human summary used by deploy.py output and the verify verdict. */
export function formatIdentityLine(identity) {
  const id = identity ?? {};
  return (
    `commit=${id.commitShort ?? UNKNOWN}${id.dirty ? '-dirty' : ''} ` +
    `stamp=${id.wasmStamp ?? UNKNOWN} ` +
    `glue=${id.glueBytes ?? 0}B wasm=${id.wasmBytes ?? 0}B ` +
    `builtAt=${id.builtAt ?? UNKNOWN}`
  );
}

// `node scripts/buildIdentity.mjs` prints the identity of the current tree.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${JSON.stringify(resolveBuildIdentity(), null, 2)}\n`);
}
