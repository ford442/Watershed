#!/usr/bin/env node
/**
 * Typecheck guard (#465 D): every non-test module under src/ must be reachable
 * from the production entry. tsc type-checks dead files happily, so orphans
 * (and the tests that keep them "covered") accumulate; this makes them fail.
 *
 * Graph: src/index.tsx (index.html's only module script) plus the `/src/...`
 * modules that verification/*.html pages load (the WGSL parity page), following relative
 * static imports, `export … from`, dynamic `import()`, `new URL('./x',
 * import.meta.url)` worker entries and Vite `?worker&url` / `?raw` suffixes.
 * `import type` edges count: a types module the live code compiles against is
 * not dead.
 *
 * Not checked: *.test.*, *.d.ts, src/testing/**, __mocks__/**, __tests__/**,
 * setupTests.ts.
 * Anything else that is deliberately unreachable goes in
 * scripts/orphans-allowlist.json with a reason; stale entries fail too.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const ENTRY = join(srcDir, 'index.tsx');
const allowlistPath = join(root, 'scripts/orphans-allowlist.json');
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

const posixRel = (abs) => relative(root, abs).split('\\').join('/');

function resolveModule(from, spec) {
  const base = resolve(dirname(from), spec.split('?')[0]);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (candidate.startsWith(srcDir) && /\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** `/src/…` module imports in the verification harness pages. */
function verificationRoots() {
  const dir = join(root, 'verification');
  const roots = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.html')) continue;
    for (const match of readFileSync(join(dir, name), 'utf8').matchAll(/['"]\/(src\/[^'"]+\.tsx?)['"]/g)) {
      roots.push(join(root, match[1]));
    }
  }
  return roots;
}

function reachable(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (!spec || !spec.startsWith('.')) continue;
      const target = resolveModule(file, spec);
      if (target) stack.push(target);
    }
  }
  return seen;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__mocks__' || name === '__tests__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p === join(srcDir, 'testing')) continue;
      walk(p, acc);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

const live = reachable([ENTRY, ...verificationRoots()]);
const errors = [];
const allowed = new Map(Object.entries(allowlist.files ?? {}));

const orphans = walk(srcDir)
  .filter((file) => file !== join(srcDir, 'setupTests.ts') && !live.has(file))
  .map(posixRel)
  .sort();

for (const file of orphans) {
  if (!allowed.has(file)) {
    errors.push(`${file} is not reachable from src/index.tsx — delete it (and its tests), wire it in, or allowlist it with a reason`);
  }
}
for (const [file, reason] of allowed) {
  if (!reason || typeof reason !== 'string') errors.push(`allowlist entry ${file} needs a reason`);
  if (!existsSync(join(root, file))) errors.push(`allowlist entry ${file} no longer exists (remove it)`);
  else if (!orphans.includes(file)) errors.push(`allowlist entry ${file} is reachable now (remove it)`);
}

if (errors.length) {
  for (const error of errors) console.error(`[orphans] ${error}`);
  process.exit(1);
}
console.log(`[orphans] ok — ${live.size} modules reachable from src/index.tsx; ${allowed.size} allowlisted`);
