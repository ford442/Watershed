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
import { dirname, relative, resolve } from 'node:path';
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
