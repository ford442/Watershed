#!/usr/bin/env node
/**
 * Typecheck guard (#535 D): `noUncheckedIndexedAccess`, ratcheted file by file.
 *
 * The buffer modules shared with the sim worker and the WASM side (src/terrain,
 * src/sim, src/systems/pools, src/systems/ghost) are where an out-of-range typed-array
 * read is a replay-smoke failure a week later, and where the flag pays for itself. A
 * global flip is ~1000 errors, so instead: tsconfig.strict-buffers.json turns the flag
 * on, this script runs it over src/, and any error in a file listed in
 * scripts/strict-buffers.json fails the gate. Errors elsewhere are ignored.
 *
 * The list only grows. A file under the ratcheted directories that is already clean but
 * not listed is printed as a hint — add it (`--write` does, keeping the list sorted).
 *
 *   node scripts/check-strict-buffers.mjs           # gate
 *   node scripts/check-strict-buffers.mjs --write   # also opt in every clean ratcheted file
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const listPath = join(root, 'scripts', 'strict-buffers.json');
const RATCHETED_DIRS = ['src/assets', 'src/terrain', 'src/sim', 'src/systems/pools', 'src/systems/ghost'];

const isSource = (rel) =>
  /\.tsx?$/.test(rel) && !/\.(test|spec)\.tsx?$/.test(rel) && !rel.endsWith('.d.ts') &&
  !rel.includes('/__tests__/') && !rel.includes('/__mocks__/');

function walk(dir, acc = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, acc);
    else if (isSource(rel)) acc.push(rel);
  }
  return acc;
}

let output = '';
try {
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.strict-buffers.json', '--noEmit', '--pretty', 'false'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (error) {
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  if (!/error TS\d+/.test(output)) throw error;
}

const errorsByFile = new Map();
for (const line of output.split('\n')) {
  const m = line.match(/^(src\/[^(]+)\(\d+,\d+\): error TS\d+/);
  if (!m) continue;
  const file = relative(root, join(root, m[1])).split('\\').join('/');
  if (!errorsByFile.has(file)) errorsByFile.set(file, []);
  errorsByFile.get(file).push(line);
}

const listed = JSON.parse(readFileSync(listPath, 'utf8'));
const failures = listed.filter((file) => errorsByFile.has(file));
const missing = listed.filter((file) => {
  try {
    return !statSync(join(root, file)).isFile();
  } catch {
    return true;
  }
});
const clean = RATCHETED_DIRS.flatMap((dir) => walk(dir)).filter((file) => !errorsByFile.has(file));
const unlisted = clean.filter((file) => !listed.includes(file)).sort();

if (process.argv.includes('--write') && unlisted.length > 0) {
  writeFileSync(listPath, `${JSON.stringify([...new Set([...listed, ...unlisted])].sort(), null, 2)}\n`);
  console.log(`[strict-buffers] opted in ${unlisted.length} clean file(s).`);
}

if (missing.length > 0) {
  console.error('[strict-buffers] listed files that no longer exist (remove them from scripts/strict-buffers.json):');
  for (const file of missing) console.error(`    - ${file}`);
}
if (failures.length > 0) {
  console.error('[strict-buffers] noUncheckedIndexedAccess errors in opted-in files:');
  for (const file of failures) for (const line of errorsByFile.get(file)) console.error(`  ${line}`);
}
if (missing.length > 0 || failures.length > 0) process.exit(1);

const pending = RATCHETED_DIRS.flatMap((dir) => walk(dir)).filter((file) => errorsByFile.has(file));
console.log(
  `[strict-buffers] ok — ${listed.length} file(s) under noUncheckedIndexedAccess; ` +
    `${pending.length} ratcheted file(s) still to go (${pending.reduce((n, f) => n + errorsByFile.get(f).length, 0)} errors).`,
);
if (unlisted.length > 0 && !process.argv.includes('--write')) {
  console.log(`  clean but not opted in (run with --write): ${unlisted.join(', ')}`);
}
