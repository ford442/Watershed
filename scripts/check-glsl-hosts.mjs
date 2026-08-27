#!/usr/bin/env node
/**
 * CI guard: every live ShaderMaterial / onBeforeCompile construction site must
 * be listed in scripts/glsl-hosts-allowlist.json.
 *
 * Kinds:
 *   dual     — GLSL factory behind createXMaterial(backend); TSL twin exists
 *   residual — live GLSL-only host (must shrink over time)
 *   dormant  — unused module (not in the scene graph)
 *
 * New construction sites fail CI unless added to the allowlist. Tests and
 * comment-only mentions are ignored.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowlistPath = join(root, 'scripts/glsl-hosts-allowlist.json');
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));

const KINDS = new Set(['dual', 'residual', 'dormant']);
const CONSTRUCT_RE = /new\s+THREE\.ShaderMaterial\s*\(|<shaderMaterial[\s>]|\.onBeforeCompile\s*=/;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === '__mocks__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx)$/.test(name)) continue;
    acc.push(p);
  }
  return acc;
}

function posixRel(abs) {
  return relative(root, abs).replaceAll('\\', '/');
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const hits = [];
for (const file of walk(join(root, 'src'))) {
  const stripped = stripComments(readFileSync(file, 'utf8'));
  if (CONSTRUCT_RE.test(stripped)) hits.push(posixRel(file));
}

const hosts = Array.isArray(allowlist.hosts) ? allowlist.hosts : [];
const byPath = new Map();
const errors = [];

for (const entry of hosts) {
  if (!entry || typeof entry.path !== 'string' || !KINDS.has(entry.kind)) {
    errors.push(`invalid allowlist entry: ${JSON.stringify(entry)}`);
    continue;
  }
  if (byPath.has(entry.path)) {
    errors.push(`duplicate allowlist path: ${entry.path}`);
  }
  byPath.set(entry.path, entry.kind);
}

const hitSet = new Set(hits);
for (const path of hits) {
  if (!byPath.has(path)) {
    errors.push(`unlisted GLSL host (add to allowlist or port to a dual-path factory): ${path}`);
  }
}
for (const path of byPath.keys()) {
  if (!hitSet.has(path)) {
    errors.push(`allowlist entry no longer constructs ShaderMaterial/onBeforeCompile (remove it): ${path}`);
  }
}

const residual = hosts.filter((h) => h.kind === 'residual').map((h) => h.path);
if (typeof allowlist.maxResidual === 'number' && residual.length > allowlist.maxResidual) {
  errors.push(
    `residual GLSL hosts grew (${residual.length} > maxResidual ${allowlist.maxResidual}): ${residual.join(', ')}`,
  );
}

if (errors.length > 0) {
  console.error('[glsl-hosts] failed:');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `[glsl-hosts] ok — ${hits.length} construction sites; residual ${residual.length}/${allowlist.maxResidual ?? residual.length}`,
);
