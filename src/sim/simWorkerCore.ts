/**
 * simWorkerCore — the sim worker's command handler, without the worker (#455).
 *
 * Pure over (module, post): `simWorker.ts` wires it to `self`, the parity test
 * drives it directly against the real binary. The grid is `createWasmSweSim` —
 * the exact stepper the main-thread path runs — so given the same command
 * stream the worker computes the same field, bit for bit.
 *
 * Phase B adds what only fed or read that field on the main thread:
 * - the river router (`createRiverRouter` on this module): STEP / SCROLL carry
 *   the player's chain index, the worker evaluates the routed edge before
 *   advancing, like the main-thread frame;
 * - water forces (`simForces.ts`), for the main thread's bodies (FORCES) and
 *   for the Rapier worker's hull over its MessagePort (HULL), both sampled on
 *   the live grid at the origin the main thread last placed it at.
 */
import type { WatershedNativeModule } from '../systems/water/WatershedWasm';
import { createWasmSweSim, type SweSim } from '../systems/water/sweSim';
import { SWE_REST_INFLOW, type SweInflow } from '../systems/water/sweScroll';
import { createRiverRouter, routedEdgeInflow, type RiverRouter } from '../systems/water/riverRouter';
import type { SWEFlowGrid } from '../systems/water/sampleSWEFlow';
import { simFrameByteLength, viewSimFrame } from './SimFrame';
import {
  FORCE_RESULT_STRIDE,
  FORCE_SAMPLE_STRIDE,
  computeSimForces,
  createSimForceBatch,
  type SimForceBatch,
} from './simForces';
import type { HullLinkPort, HullLinkToPhysics, HullLinkToSim } from './hullLinkProtocol';
import type { SimRoute, SimWorkerCommand, SimWorkerResponse, SurfaceOps } from './simWorkerProtocol';

/** Spare frame buffers kept for reuse; two cover the in-flight + next frame. */
const FRAME_POOL_LIMIT = 2;

export interface SimWorkerCore {
  handle(command: SimWorkerCommand): void;
  dispose(): void;
}

type PhysicsPort = HullLinkPort<HullLinkToSim, HullLinkToPhysics>;

interface RouterState {
  router: RiverRouter | null;
  H: number;
  g: number;
}

export function createSimWorkerCore(
  wasm: WatershedNativeModule,
  post: (response: SimWorkerResponse, transfer?: Transferable[]) => void,
  now: () => number = () => performance.now(),
): SimWorkerCore {
  let sim: SweSim | null = null;
  let gridId = -1;
  let epoch = 0;
  let frameIndex = 0;
  let frameBytes = 0;
  // World XZ of the live grid's cell (0, 0); NaN until the main thread places it.
  let originX = Number.NaN;
  let originZ = Number.NaN;
  const pool: ArrayBuffer[] = [];
  const routing: RouterState = { router: null, H: 1, g: 9.80665 };
  let lastInflow: SweInflow | null = null;
  let forceBatch: SimForceBatch | null = null;
  let forceScratch = new Float64Array(0);
  let physicsPort: PhysicsPort | null = null;

  const live = (id: number): SweSim | null => (sim && id === gridId ? sim : null);

  const applySurface = (grid: SweSim, surface: SurfaceOps) => {
    for (let i = 0; i + 1 < surface.length; i += 2) grid.addSurface(surface[i], surface[i + 1]);
  };

  const routedAt = (route: SimRoute | undefined) => {
    if (!route) return null;
    const routed = routedEdgeInflow(routing.router, route.chainIndex, routing.H, routing.g);
    lastInflow = routed?.inflow ?? null;
    return routed;
  };

  const flowGridAt = (x: number, z: number): SWEFlowGrid | null => {
    if (!sim || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    return {
      h: sim.h,
      u: sim.u,
      w: sim.w,
      b: sim.b,
      width: sim.width,
      height: sim.height,
      cellSize: sim.dx,
      originX: x,
      originZ: z,
    };
  };

  /** Forces for `count` samples, written back over `samples` (results are shorter). */
  const forcesInPlace = (grid: SWEFlowGrid | null, samples: Float64Array, count: number) => {
    const n = Math.max(0, Math.min(count, Math.floor(samples.length / FORCE_SAMPLE_STRIDE)));
    forceBatch ??= createSimForceBatch(wasm);
    if (forceScratch.length < n * FORCE_RESULT_STRIDE) forceScratch = new Float64Array(n * FORCE_RESULT_STRIDE);
    const stats = computeSimForces(wasm, forceBatch, grid, samples, n, forceScratch, now);
    samples.set(forceScratch.subarray(0, n * FORCE_RESULT_STRIDE));
    return { n, ...stats };
  };

  const onHull = (event: MessageEvent<HullLinkToSim>) => {
    const message = event.data;
    if (message?.type !== 'HULL' || !physicsPort) return;
    try {
      const { computeMicros } = forcesInPlace(flowGridAt(originX, originZ), message.sample, 1);
      physicsPort.postMessage(
        { type: 'HULL_FORCE', seq: message.seq, result: message.sample, computeMicros },
        [message.sample.buffer],
      );
    } catch (error) {
      post({ type: 'ERROR', error: error instanceof Error ? error.message : String(error), fatal: true });
    }
  };

  const disconnectPhysics = () => {
    physicsPort?.removeEventListener('message', onHull);
    physicsPort?.close?.();
    physicsPort = null;
  };

  const publish = (grid: SweSim, computeMicros: number) => {
    const buffer = pool.pop() ?? new ArrayBuffer(frameBytes);
    const planes = viewSimFrame(buffer, grid.width * grid.height);
    planes.eta.set(grid.h);
    planes.u.set(grid.u);
    planes.w.set(grid.w);
    planes.b.set(grid.b);
    frameIndex += 1;
    post(
      {
        type: 'FRAME',
        frame: {
          gridId,
          frameIndex,
          epoch,
          width: grid.width,
          height: grid.height,
          computeMicros,
          backend: 'wasm-worker',
          inflow: lastInflow,
          buffer,
        },
      },
      [buffer],
    );
  };

  const disposeGrid = () => {
    sim?.dispose();
    sim = null;
    originX = Number.NaN;
    originZ = Number.NaN;
  };

  const disposeRouter = () => {
    routing.router?.dispose();
    routing.router = null;
    lastInflow = null;
  };

  return {
    handle(command) {
      switch (command.type) {
        case 'INIT':
          post({ type: 'READY', abi: wasm.getVersion() });
          return;
        case 'CONFIGURE':
          disposeGrid();
          sim = createWasmSweSim(wasm, command.width, command.height, command.dx);
          gridId = command.gridId;
          epoch = 0;
          frameIndex = 0;
          frameBytes = simFrameByteLength(command.width * command.height);
          pool.length = 0;
          return;
        case 'COMMIT_BED': {
          const grid = live(command.gridId);
          if (!grid) return;
          if (command.b.length === grid.b.length) grid.b.set(command.b);
          epoch += 1;
          return;
        }
        case 'ORIGIN':
          if (!live(command.gridId)) return;
          originX = command.originX;
          originZ = command.originZ;
          return;
        case 'SCROLL': {
          const grid = live(command.gridId);
          if (!grid) return;
          applySurface(grid, command.surface);
          if (command.fill.kind === 'inflow') {
            grid.scroll(command.shiftX, command.shiftZ, command.fill.inflow);
          } else {
            const routed = routedAt(command.fill.route);
            if (routed || !command.fill.requireRouted) {
              grid.scroll(command.shiftX, command.shiftZ, routed?.inflow ?? SWE_REST_INFLOW);
            }
          }
          if (command.origin) {
            originX = command.origin.x;
            originZ = command.origin.z;
          }
          // Always: the mirror advanced its epoch when it posted this.
          epoch += 1;
          return;
        }
        case 'STEP': {
          const grid = live(command.gridId);
          if (!grid) return;
          // Main-thread order: edge from the router's current state, then advance.
          const routed = routedAt(command.route);
          if (command.route) routing.router?.advance(command.input.dt);
          applySurface(grid, command.surface);
          const t0 = now();
          grid.step(command.route ? { ...command.input, edgeEta: routed?.edgeEta } : command.input);
          publish(grid, Math.round((now() - t0) * 1000));
          return;
        }
        case 'RETURN_FRAME':
          if (command.buffer.byteLength === frameBytes && pool.length < FRAME_POOL_LIMIT) {
            pool.push(command.buffer);
          }
          return;
        case 'DISPOSE_GRID':
          if (command.gridId === gridId) disposeGrid();
          return;
        case 'ROUTER':
          disposeRouter();
          routing.router = createRiverRouter(wasm, command.reach, command.launchHour, {
            forecast: command.forecast,
          });
          routing.H = command.H;
          routing.g = command.g;
          return;
        case 'DISPOSE_ROUTER':
          disposeRouter();
          return;
        case 'FORCES': {
          const grid = live(command.gridId) ? flowGridAt(command.originX, command.originZ) : null;
          const { n, calls, computeMicros } = forcesInPlace(grid, command.samples, command.count);
          post(
            { type: 'FORCES', seq: command.seq, count: n, results: command.samples, calls, computeMicros },
            [command.samples.buffer],
          );
          return;
        }
        case 'CONNECT_PHYSICS':
          disconnectPhysics();
          physicsPort = command.port as unknown as PhysicsPort;
          physicsPort.addEventListener('message', onHull);
          physicsPort.start?.();
          return;
      }
    },
    dispose() {
      disposeGrid();
      disposeRouter();
      disconnectPhysics();
      forceBatch?.dispose();
      forceBatch = null;
      pool.length = 0;
    },
  };
}
