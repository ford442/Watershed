#!/usr/bin/env node
/**
 * CI guard (#371, tightened in #397): src/systems/ root holds the store and the
 * thin barrel, nothing else. Everything is a domain folder.
 *
 * Allowed root *.ts: GameState.ts, index.ts
 * Allowed root *.tsx: none. The three deferred React hosts moved in #397 —
 * BiomeSystem → biome/, LODManager → lod/, SplashSystem → water/ — and
 * PostProcessing.tsx must not return (deleted in #371).
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

const bannedTsx = readdirSync(systemsDir).filter((name) => name.endsWith('.tsx'));
if (bannedTsx.length > 0) {
  console.error('[systems-layout] Root-level src/systems/*.tsx is not allowed — move it into a domain folder.');
  console.error('  biome/ for biome context, lod/ for LOD, water/ for splash & hydro, …');
  console.error('  Banned:');
  for (const name of bannedTsx) console.error(`    - ${name}`);
  process.exit(1);
}

console.log(`[systems-layout] ok — root ts: ${rootTs.join(', ') || '(none)'}; root tsx: (none)`);
