/**
 * The Rapier worker does not instantiate watershed_native (#455 Phase B).
 *
 * Its raft force comes from the sim worker over the hull link, so its module
 * graph must not reach the worker loader (src/sim/workerWasm.ts) and no module
 * in it may call a loader. Walked statically from the worker entry over every
 * relative import (static, dynamic and `export … from`): a regression that
 * re-adds a loader to this worker — a third instance per session — fails here
 * without a browser.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduleGraph } from '../testing/moduleGraph';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Rapier worker module graph', () => {
  const entry = resolve(srcDir, 'physics/rapier.worker.ts');
  const graph = moduleGraph(srcDir, entry).files;
  const files = [...graph.keys()].map((f) => relative(srcDir, f));

  it('is walked from the real entry', () => {
    expect(files).toContain('physics/rapier.worker.ts');
    expect(files).toContain('physics/hullLinkClient.ts');
  });

  it('computes no water force: the TS mirror and the native force batch stay out (#467)', () => {
    // The hull force is the sim worker's (hull link) or the main thread's TS
    // mirror sent with the step — waterForceAuthority.ts pickHullForce.
    expect(files).not.toContain('systems/water/waterForceFallback.ts');
    expect(files).not.toContain('physics/hullMirrorForce.ts');
  });

  it('does not import the worker WASM loader', () => {
    expect(files).not.toContain('sim/workerWasm.ts');
    expect(files).not.toContain('physics/workerWasm.ts');
  });

  it('never calls a watershed_native loader', () => {
    const loaders = /\b(?:getWorkerWasm|getWasm|peekWasm)\s*\(/;
    for (const [file, source] of graph) {
      // Comments mention the loaders, and WatershedWasm.ts DEFINES getWasm /
      // peekWasm for the main thread: defining is not calling.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/export (?:async )?function (?:getWasm|peekWasm)\s*\(/g, '');
      expect(loaders.test(code), `${relative(srcDir, file)} calls a loader`).toBe(false);
    }
  });
});

/**
 * #485 B — Rapier's wasm is one hashed asset, not base64 text in two bundles.
 *
 * `@dimforge/rapier3d-compat` inlines its 1.57 MB .wasm as a 2.09 M-char base64
 * literal; bundled into both the main-thread `<Physics>` world and this worker
 * that was 2 x 2.2 MB of JS the parser had to chew through. vite.config.ts
 * (`rapierWasmAssetPlugin`) now emits `rapier_wasm3d_bg-*.wasm` once and both
 * bundles load it by URL. This inspects the real production output, so it only
 * runs where `vite build` has run (CI builds before `pnpm test`).
 */
const repoRoot = resolve(srcDir, '..');
const assetsDir = join(repoRoot, 'build/assets');
const built = existsSync(assetsDir) && readdirSync(assetsDir).some((f) => /^rapier\.worker-.*\.js$/.test(f));

describe.skipIf(!built)('Rapier wasm in the production build', () => {
  const files = built ? readdirSync(assetsDir) : [];
  const chunks = files.filter((f) => f.endsWith('.js'));
  const wasm = files.filter((f) => /^rapier_wasm3d_bg-[^/]+\.wasm$/.test(f));
  // Rapier's literal is 2.09 M chars; the third-party wasm decoder and the SMAA
  // lookup PNG that legitimately sit in the entry are both under 50 k. A linear
  // scan: a `{100000,}` regex over 1 MB chunks backtracks past the test timeout.
  const RAPIER_SIZED_BASE64 = 100_000;
  const longestBase64Run = (text: string): number => {
    let best = 0;
    let run = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      const b64 =
        (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61;
      run = b64 ? run + 1 : 0;
      if (run > best) best = run;
    }
    return best;
  };

  it('ships exactly one rapier .wasm, byte-for-byte the one in the package', () => {
    expect(wasm).toHaveLength(1);
    const shipped = readFileSync(join(assetsDir, wasm[0]));
    const pkg = readFileSync(join(repoRoot, 'node_modules/@dimforge/rapier3d-compat/rapier_wasm3d_bg.wasm'));
    expect(shipped.equals(pkg)).toBe(true);
  });

  it('keeps the base64 wasm literal out of every chunk, the physics worker included', () => {
    const worker = chunks.find((f) => f.startsWith('rapier.worker-'));
    expect(worker).toBeDefined();
    for (const f of chunks) {
      const text = readFileSync(join(assetsDir, f), 'utf8');
      expect(longestBase64Run(text), `${f} holds a Rapier-sized base64 literal`).toBeLessThan(RAPIER_SIZED_BASE64);
    }
    const workerText = readFileSync(join(assetsDir, worker!), 'utf8');
    expect(workerText.includes('data:application/wasm')).toBe(false);
    // The glue + world code is ~150 kB; the wasm bytes inlined would be > 2 MB.
    expect(statSync(join(assetsDir, worker!)).size).toBeLessThan(400_000);
  });

  it('has the worker and the main thread load the same hashed file by URL', () => {
    const name = wasm[0];
    const refs = chunks.filter((f) => readFileSync(join(assetsDir, f), 'utf8').includes(name));
    expect(refs.some((f) => f.startsWith('rapier.worker-'))).toBe(true);
    expect(refs.some((f) => f.startsWith('index-'))).toBe(true);
  });
});
