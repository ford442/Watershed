#!/usr/bin/env node
/**
 * CI guard (#371): ban new root-level src/systems/*.ts except the allowlist.
 *
 * Allowed root *.ts: GameState.ts, index.ts
 * Deferred root *.tsx hosts (not banned by this *.ts rule): BiomeSystem,
 * LODManager, SplashSystem. PostProcessing.tsx must not return (deleted in #371).
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const systemsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'systems');

const ALLOWED_ROOT_TS = new Set(['GameState.ts', 'index.ts']);

const rootTs = readdirSync(systemsDir).filter((name) => name.endsWith('.ts'));
const banned = rootTs.filter((name) => !ALLOWED_ROOT_TS.has(name));

if (banned.length > 0) {
  console.error('[systems-layout] Root-level src/systems/*.ts must be GameState.ts or index.ts only.');
  console.error('  Move new modules into a domain folder (journey/, water/, map/, …).');
  console.error('  Banned:');
  for (const name of banned) console.error(`    - ${name}`);
  process.exit(1);
}

const rootTsx = readdirSync(systemsDir).filter((name) => name.endsWith('.tsx'));
/** Deferred Experience hosts only (do not add PostProcessing — deleted dead dual). */
const ALLOWED_ROOT_TSX = new Set([
  'BiomeSystem.tsx',
  'LODManager.tsx',
  'SplashSystem.tsx',
]);
const bannedTsx = rootTsx.filter((name) => !ALLOWED_ROOT_TSX.has(name));
if (bannedTsx.length > 0) {
  console.error('[systems-layout] Unexpected root-level src/systems/*.tsx (deferred hosts only).');
  console.error('  Allowed:', [...ALLOWED_ROOT_TSX].join(', '));
  console.error('  Banned:');
  for (const name of bannedTsx) console.error(`    - ${name}`);
  process.exit(1);
}

console.log(
  `[systems-layout] ok — root ts: ${rootTs.join(', ') || '(none)'}; deferred tsx: ${rootTsx.join(', ') || '(none)'}`,
);
