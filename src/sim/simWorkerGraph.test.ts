/**
 * The sim worker's bundle stays a solver bundle (#455 Phase B).
 *
 * The router and the force sampling moved in, and both have main-thread
 * neighbours that pull in the map registry (every authored map), React or
 * THREE. The worker gets the routed chain as data (ROUTER) and the constants
 * from leaf modules, so none of those may be reachable from its entry.
 */
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduleGraph } from '../testing/moduleGraph';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('sim worker module graph', () => {
  const { files, packages } = moduleGraph(srcDir, resolve(srcDir, 'sim/simWorker.ts'));
  const reachable = [...files.keys()].map((f) => relative(srcDir, f));

  it('holds the stepper, the router, the forces and the loader', () => {
    for (const file of [
      'sim/simWorkerCore.ts',
      'sim/workerWasm.ts',
      'sim/simForces.ts',
      'systems/water/riverRouter.ts',
      'systems/water/sampleSWEFlow.ts',
    ]) {
      expect(reachable).toContain(file);
    }
  });

  it('does not reach the map registry, React or THREE', () => {
    expect(reachable.filter((f) => f.startsWith('maps/'))).toEqual([]);
    expect(reachable).not.toContain('systems/map/routingReach.ts');
    expect(reachable).not.toContain('experience/constants.ts');
    expect(reachable).not.toContain('systems/water/SWEHeightField.ts');
    expect([...packages].filter((p) => /^(three|react|@react-three)/.test(p))).toEqual([]);
  });
});
