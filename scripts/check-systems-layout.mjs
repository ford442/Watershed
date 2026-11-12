#!/usr/bin/env node
/**
 * CI guard (#371, tightened here): `src/systems/` root holds the store and the
 * thin barrel, nothing else. Everything is a domain folder.
 *
 * Allowed root `*.ts`: GameState.ts (the systems/index.ts barrel had no importers; #465 D)
 * Allowed root `*.tsx`: none. The three deferred React hosts moved —
 * BiomeSystem → biome/, LODManager → lod/, SplashSystem → water/ — and
 * PostProcessing.tsx must not return (deleted in #371). The carve-out that
 * allowed those three is gone on purpose: it was the only thing keeping the
 * rule from being "no root modules", and a permanent exception list is how a
 * layout rule stops being a rule.
 *
 * Also: `src/rendering/index.ts` must not return (#554 F.2). It re-exported ~80
 * names from 12 modules for six importers, so every one of them pulled the whole
 * renderer surface into its module graph; importers name the module instead.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const systemsDir = join(srcDir, 'systems');

for (const name of ['index.ts', 'index.tsx']) {
  if (existsSync(join(srcDir, 'rendering', name))) {
    console.error(`[systems-layout] src/rendering/${name} is a barrel and was removed (#554 F.2).`);
    console.error("  Import from the module itself, e.g. '../rendering/deriveRendererContextOptions'.");
    process.exit(1);
  }
}

const ALLOWED_ROOT_TS = new Set(['GameState.ts']);

const rootTs = readdirSync(systemsDir).filter((name) => name.endsWith('.ts'));
const banned = rootTs.filter((name) => !ALLOWED_ROOT_TS.has(name));

if (banned.length > 0) {
  console.error('[systems-layout] Root-level src/systems/*.ts must be GameState.ts only.');
  console.error('  Move new modules into a domain folder (journey/, water/, map/, …).');
  console.error('  Banned:');
  for (const name of banned) console.error(`    - ${name}`);
  process.exit(1);
}

const rootTsx = readdirSync(systemsDir).filter((name) => name.endsWith('.tsx'));
if (rootTsx.length > 0) {
  console.error('[systems-layout] Root-level src/systems/*.tsx is not allowed — move it into a domain folder.');
  console.error('  biome/ for biome context, lod/ for LOD, water/ for splash & hydro, …');
  console.error('  Banned:');
  for (const name of rootTsx) console.error(`    - ${name}`);
  process.exit(1);
}

console.log(
  `[systems-layout] ok — root ts: ${rootTs.join(', ') || '(none)'}; root tsx: (none); no rendering barrel`,
);
