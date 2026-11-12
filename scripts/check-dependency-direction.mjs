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
 *   - assets/ loads authored packs for any consumer (#536) — a prop's primitive
 *     fallback is passed in by the vehicle / component that owns it, never imported;
 *   - math/ is a leaf: it imports nothing from src/;
 *   - constants/ imports only constants/ and configs/.
 *
 * Every edge counts — static, dynamic `import()`, `export … from` and
 * `import type` (a type import still couples the layers' contracts). Tests,
 * __tests__/ and __mocks__/ are exempt: a test may reach anywhere to stage a
 * scene. Exceptions go in RULES[].allow with a reason, not around the script.
 *
 * The Node campaign harness (#556 B), src/sim/headless/, is a composition root like
 * experience/: it builds a run out of the sim, the vehicle step, the treadmill and
 * the water, so it may import any layer (and the Zustand store the sim's systems
 * still use) and is exempt from the sim rules below. The reverse is the rule: it
 * is Node-only (fs, the shipped wasm, Rapier -compat), so no module outside it —
 * app code, the sim, a component — may import it; only tests and itself.
 *
 * Headless sim (#556 A). The gameplay step must run in Node with no React app
 * (the headless campaign), so the modules SimCore steps — everything under
 * sim/, every `*SimSystem.ts` and the vehicle steps (`vehicles/<v>/hooks/*Step.ts`)
 * — may not import React, the Zustand store (`systems/GameState`), hooks/,
 * components/ (a sibling in the file's own folder aside), ui/, a `.tsx` module
 * or audio playback. They read the run through `ctx.game` and emit cues on
 * `gameEvents` instead. Two checks:
 *   - direct: those files' own imports (every edge, as above);
 *   - runtime closure: from the SimCore entries below, every module Node would
 *     actually load (type-only edges are erased, so they do not count) — a
 *     helper two hops down that imports the store breaks a headless run as
 *     surely as the step itself. Known debts go in CLOSURE_ALLOW with a reason.
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
  { from: 'assets', banned: ['components', 'vehicles', 'experience', 'ui'] },
  { from: 'math', onlyWithin: ['math'] },
  { from: 'constants', onlyWithin: ['constants', 'configs'] },
];

/** Files the headless-sim rule covers (repo-relative). */
const HEADLESS_DIR = 'src/sim/headless/';
const isSimFile = (rel) =>
  (rel.startsWith('src/sim/') && !rel.startsWith(HEADLESS_DIR)) ||
  /SimSystem\.ts$/.test(rel) ||
  /^src\/vehicles\/[^/]+\/hooks\/[^/]*Step\.ts$/.test(rel);

/** Runtime-closure entries: the modules a headless run steps. */
const SIM_CLOSURE_ENTRIES = [
  'src/sim/core/SimCore.ts',
  'src/physics/rapierWorldSimSystem.ts',
  'src/vehicles/RunnerVehicle/runnerSimSystem.ts',
  'src/vehicles/RunnerVehicle/runnerCameraSync.ts',
  'src/systems/weather/weatherSimSystem.ts',
  'src/systems/sky/skySimSystem.ts',
  'src/systems/map/chunkBiomeSystem.ts',
  'src/systems/gameplay/gameplaySimSystem.ts',
  'src/systems/journey/survivalSystem.ts',
  'src/systems/hazards/hazardSimSystem.ts',
  'src/components/Obstacles/pillarSimSystem.ts',
];

/** Closure edges allowed for now: `from → to` (repo-relative), each with its reason. */
const CLOSURE_ALLOW = new Map([
  [
    'src/input/InputHub.ts -> zustand',
    'hazardSimSystem → hazardLog → ghost/GhostRecorder → InputHub, whose device-status store is a zustand hook; ' +
      '#556 B gives the ghost recorder the frame through ctx instead',
  ],
]);

const BANNED_SIM_PACKAGES = /^(react|react-dom|zustand)$|^@react-three\//;

/** Why a target (repo-relative path) is off-limits to sim code, or null. */
function simBan(fromRel, targetRel) {
  if (targetRel === 'src/systems/GameState.ts') return 'the Zustand store (read ctx.game)';
  if (targetRel.startsWith('src/hooks/')) return 'hooks/ (React)';
  if (targetRel.startsWith('src/ui/')) return 'ui/';
  if (targetRel === 'src/systems/audio/AudioSystem.ts' || /^src\/vehicles\/[^/]+\/audio\.ts$/.test(targetRel)) {
    return 'audio playback (emit a vehicle cue)';
  }
  if (targetRel.startsWith('src/components/') && dirname(targetRel) !== dirname(fromRel)) return 'components/';
  if (targetRel.endsWith('.tsx')) return 'a .tsx module (React)';
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Value (runtime) edges only: `import type` / `export type` are erased. */
const RUNTIME_IMPORT_RE =
  /(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

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
  return resolveRelative(fromFile, spec);
}

function resolveRelative(fromFile, spec) {
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
  // The campaign harness may import any layer (see the header); who imports it is checked below.
  const rules = rel.startsWith(HEADLESS_DIR) ? [] : RULES.filter((r) => r.from === layer);
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

const relOf = (abs) => relative(root, abs).split('\\').join('/');

// The Node-only campaign harness is imported by tests alone (any layer, every edge kind).
for (const file of walk(srcDir)) {
  const rel = relOf(file);
  if (isExempt(rel) || rel.startsWith(HEADLESS_DIR)) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('.')) continue;
    if (relOf(resolveRelative(file, spec)).startsWith(HEADLESS_DIR)) {
      violations.push(`${rel}: '${spec}' (the Node-only campaign harness, src/sim/headless/, is imported by tests alone)`);
    }
  }
}

// Headless sim, direct imports.
const simDirect = [];
for (const file of walk(srcDir)) {
  const rel = relOf(file);
  if (isExempt(rel) || !isSimFile(rel)) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('.')) {
      if (BANNED_SIM_PACKAGES.test(spec)) simDirect.push(`${rel}: '${spec}' (React / the store's zustand)`);
      continue;
    }
    const why = simBan(rel, relOf(resolveRelative(file, spec)));
    if (why) simDirect.push(`${rel}: '${spec}' (${why})`);
  }
}

// Headless sim, runtime closure from the entries.
const simClosure = [];
const usedAllow = new Set();
const seen = new Map(); // abs → parent abs (for the chain)
const queue = [];
for (const entry of SIM_CLOSURE_ENTRIES) {
  const abs = join(root, entry);
  if (!existsSync(abs)) {
    simClosure.push(`${entry}: listed in SIM_CLOSURE_ENTRIES but missing`);
    continue;
  }
  if (!seen.has(abs)) {
    seen.set(abs, null);
    queue.push(abs);
  }
}
const chainOf = (abs) => {
  const chain = [];
  for (let at = abs; at; at = seen.get(at)) chain.unshift(relOf(at).replace(/^src\//, ''));
  return chain.join(' -> ');
};
while (queue.length > 0) {
  const file = queue.shift();
  const rel = relOf(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(RUNTIME_IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('.')) {
      if (!BANNED_SIM_PACKAGES.test(spec)) continue;
      const key = `${rel} -> ${spec}`;
      if (CLOSURE_ALLOW.has(key)) usedAllow.add(key);
      else simClosure.push(`${chainOf(file)} -> '${spec}'`);
      continue;
    }
    const target = resolveRelative(file, spec);
    const targetRel = relOf(target);
    const why = simBan(rel, targetRel);
    if (why) {
      const key = `${rel} -> ${targetRel}`;
      if (CLOSURE_ALLOW.has(key)) usedAllow.add(key);
      else simClosure.push(`${chainOf(file)} -> ${targetRel.replace(/^src\//, '')} (${why})`);
      continue;
    }
    if (!existsSync(target) || seen.has(target)) continue;
    seen.set(target, file);
    queue.push(target);
  }
}
for (const key of CLOSURE_ALLOW.keys()) {
  if (!usedAllow.has(key)) simClosure.push(`CLOSURE_ALLOW entry no longer needed (remove it): ${key}`);
}

let failed = false;
if (violations.length > 0) {
  failed = true;
  console.error('[dependency-direction] Imports that point up the layer stack:');
  for (const v of violations) console.error(`  - ${v}`);
  console.error('  See the rules at the top of scripts/check-dependency-direction.mjs.');
}
if (simDirect.length > 0 || simClosure.length > 0) {
  failed = true;
  console.error('[dependency-direction] Sim code that a headless run could not load (#556 A):');
  for (const v of simDirect) console.error(`  - ${v}`);
  for (const v of simClosure) console.error(`  - closure: ${v}`);
  console.error('  Read the run through ctx.game, emit a gameEvents cue for presentation;');
  console.error('  see "Headless sim" at the top of scripts/check-dependency-direction.mjs.');
}
if (failed) process.exit(1);
console.log(
  `[dependency-direction] ok — ${RULES.length} layer rules, no upward imports; ` +
    `headless sim: ${seen.size} modules from ${SIM_CLOSURE_ENTRIES.length} entries, none React / store / audio.`,
);
