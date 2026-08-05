#!/usr/bin/env node
/**
 * CI guard: tracks residual untyped `.js` / `.jsx` modules excluded from
 * `tsconfig.typecheck.json`. The allowlist must match disk exactly — shrink it
 * as modules migrate to `.ts` / `.tsx`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const allowlistPath = join(root, 'scripts', 'untyped-allowlist.json');

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (entry.endsWith('.js') || entry.endsWith('.jsx')) {
      acc.push(relative(srcDir, full).replace(/\\/g, '/'));
    }
  }
  return acc.sort();
}

const onDisk = walk(srcDir);
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
const allowSorted = [...allowlist].sort();

const missingFromAllowlist = onDisk.filter((file) => !allowSorted.includes(file));
const staleAllowlist = allowSorted.filter((file) => !onDisk.includes(file));

if (missingFromAllowlist.length > 0 || staleAllowlist.length > 0) {
  console.error('[typecheck-surface] untyped allowlist drift detected.');
  if (missingFromAllowlist.length > 0) {
    console.error('  Add to scripts/untyped-allowlist.json (or migrate to TS):');
    for (const file of missingFromAllowlist) console.error(`    - ${file}`);
  }
  if (staleAllowlist.length > 0) {
    console.error('  Remove from scripts/untyped-allowlist.json (migrated or deleted):');
    for (const file of staleAllowlist) console.error(`    - ${file}`);
  }
  process.exit(1);
}

console.log(`[typecheck-surface] ${onDisk.length} untyped modules tracked (target: shrink toward 0).`);
