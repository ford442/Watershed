#!/usr/bin/env node
/**
 * CI guard: `src/` is TypeScript only. The last untyped modules were the two precompiled
 * validators, which scripts/compile-validators.mjs now emits as `.ts` (#535 A); with them
 * gone, `allowJs` and the untyped allowlist were deleted. A new `.js` / `.jsx` / `.mjs` /
 * `.cjs` file under src/ would be invisible to `tsc` (no `allowJs`), so it fails here.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (/\.(js|jsx|mjs|cjs)$/.test(entry)) acc.push(relative(srcDir, full).replace(/\\/g, '/'));
  }
  return acc.sort();
}

const untyped = walk(srcDir);
if (untyped.length > 0) {
  console.error('[typecheck-surface] untyped modules under src/ (tsconfig has no allowJs; migrate to TS):');
  for (const file of untyped) console.error(`    - ${file}`);
  process.exit(1);
}
console.log('[typecheck-surface] ok — src/ is TypeScript only.');
