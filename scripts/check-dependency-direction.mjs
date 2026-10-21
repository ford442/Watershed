#!/usr/bin/env node
/**
 * Typecheck guard (#503 E): import direction between src/ layers.
 *
 * The layers below a React host must not reach up into one:
 *   - terrain/ is worker-safe by contract (the sim worker builds meshes with
 *     it) — no components/, vehicles/, experience/, hooks/ or ui/;
 *   - systems/, physics/ and sim/ hold the game's state and simulation —
 *     no components/ or vehicles/ (a vehicle tunable they read lives in
 *     constants/, a React host they mount lives in experience/);
 *   - math/ is a leaf: it imports nothing from src/;
 *   - constants/ imports only constants/ and configs/.
 *
 * Every edge counts — static, dynamic `import()`, `export … from` and
 * `import type` (a type import still couples the layers' contracts). Tests,
 * __tests__/ and __mocks__/ are exempt: a test may reach anywhere to stage a
 * scene. Exceptions go in RULES[].allow with a reason, not around the script.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

const RULES = [
  { from: 'terrain', banned: ['components', 'vehicles', 'experience', 'hooks', 'ui'] },
  { from: 'systems', banned: ['components', 'vehicles'] },
  { from: 'physics', banned: ['components', 'vehicles', 'experience'] },
  { from: 'sim', banned: ['components', 'vehicles', 'experience'] },
  { from: 'math', onlyWithin: ['math'] },
  { from: 'constants', onlyWithin: ['constants', 'configs'] },
];

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const isExempt = (rel) =>
  /\.(test|spec)\.tsx?$/.test(rel) || rel.includes('/__tests__/') || rel.includes('/__mocks__/');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // packages are not layers
  const base = resolve(dirname(fromFile), spec.split('?')[0]);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return base;
}

/** First path segment under src/ ('' for a root module like src/App.tsx). */
const layerOf = (abs) => {
  const rel = relative(srcDir, abs).split('\\').join('/');
  if (rel.startsWith('..')) return null;
  return rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '';
};

const violations = [];
for (const file of walk(srcDir)) {
  const rel = relative(root, file).split('\\').join('/');
  if (isExempt(rel)) continue;
  const layer = layerOf(file);
  const rules = RULES.filter((r) => r.from === layer);
  if (rules.length === 0) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    const target = resolveSpec(file, spec);
    if (!target) continue;
    const targetLayer = layerOf(target);
    if (targetLayer === null) continue;
    for (const rule of rules) {
      const bad = rule.banned
        ? rule.banned.includes(targetLayer)
        : !rule.onlyWithin.includes(targetLayer);
      if (bad) violations.push(`${rel}: '${spec}' (${layer}/ → ${targetLayer || 'src root'}/)`);
    }
  }
}

if (violations.length > 0) {
  console.error('[dependency-direction] Imports that point up the layer stack:');
  for (const v of violations) console.error(`  - ${v}`);
  console.error('  See the rules at the top of scripts/check-dependency-direction.mjs.');
  process.exit(1);
}
console.log(`[dependency-direction] ok — ${RULES.length} layer rules, no upward imports.`);
