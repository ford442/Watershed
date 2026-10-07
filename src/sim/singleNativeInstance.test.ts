/**
 * One `watershed_native` per session. On a WebGL boot with the sim worker the
 * module is instantiated only in the worker (src/sim/workerWasm.ts); the
 * main-thread loader (`getWasm`) is reached only when the session's stepper
 * lives on the main thread (`wasm-main`). Static, over every non-test module
 * under src/: a regression that re-adds a loader to a particle system, the
 * chores, or the HUD — a second instance per WebGL session — fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduleGraph } from '../testing/moduleGraph';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__mocks__' && name !== 'testing') sourceFiles(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Code without comments, and without the loaders' own definitions. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/export (?:async )?function (?:getWasm|peekWasm)\s*\(/g, '');
}

const LOADER_CALL = /\b(?:getWasm|peekWasm)\s*\(/;

const files = sourceFiles(srcDir).map((path) => ({
  rel: relative(srcDir, path),
  code: code(readFileSync(path, 'utf8')),
}));

describe('one watershed_native per session', () => {
  it('splash, waterfall, chores and the HUD never call the main-thread loader', () => {
    for (const rel of [
      'systems/water/SplashSystem.tsx',
      'components/Environment/WaterfallParticles.tsx',
      'rendering/gpuChores/watershedHost.ts',
      'rendering/gpuChores/heightfield.ts',
      'components/GameHUD.tsx',
    ]) {
      const file = files.find((f) => f.rel === rel);
      expect(file, rel).toBeDefined();
      expect(LOADER_CALL.test(file!.code), `${rel} calls a loader`).toBe(false);
      expect(/\bimport\s*\{[^}]*\b(?:getWasm|peekWasm)\b[^}]*\}\s*from/.test(file!.code), `${rel} imports a loader`).toBe(false);
    }
  });

  it('only the wasm-main owners call getWasm / peekWasm', () => {
    const callers = files.filter((f) => LOADER_CALL.test(f.code)).map((f) => f.rel).sort();
    expect(callers).toEqual([
      // Debug harness, mounted only behind its explicit test flag (VehicleMount).
      'components/WasmWaterForceTest.tsx',
      // The particle owner: `wasm-main` / failed handshake only (nativeOwner.test.ts).
      'sim/nativeOwner.ts',
      // `loadMainWasm`: `wasm-main`, a failed handshake, or a failed WGSL init.
      'systems/water/WaterForceSystem.tsx',
    ]);
    const forceSystem = files.find((f) => f.rel === 'systems/water/WaterForceSystem.tsx')!;
    expect(forceSystem.code.match(/\bgetWasm\s*\(/g)).toHaveLength(1);
  });

  it('instantiates the glue in exactly two loaders: the sim worker and the wasm-main fallback', () => {
    const instantiators = files
      .filter((f) => /\bWatershedNativeFactory\b/.test(f.code) && /\bfactory\s*\(\s*\{/.test(f.code))
      .map((f) => f.rel)
      .sort();
    expect(instantiators).toEqual(['sim/workerWasm.ts', 'systems/water/WatershedWasm.ts']);
  });

  it('the sim worker graph holds the particle and chore kernels it now runs', () => {
    const reachable = [...moduleGraph(srcDir, resolve(srcDir, 'sim/simWorker.ts')).files.keys()]
      .map((f) => relative(srcDir, f));
    expect(reachable).toContain('rendering/gpuChores/watershedHost.ts');
    expect(reachable).toContain('rendering/gpuChores/heightfieldSummary.ts');
    // …and not the main-thread chores runtime (WebGPU lane, device registry).
    expect(reachable).not.toContain('rendering/gpuChores/createRuntime.ts');
    expect(reachable).not.toContain('rendering/gpuChores/index.ts');
  });
});
