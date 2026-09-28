/**
 * simWorkerCore — the sim worker's command handler, without the worker (#455).
 *
 * Pure over (module, post): `simWorker.ts` wires it to `self`, the parity test
 * drives it directly against the real binary. The grid is `createWasmSweSim` —
 * the exact stepper the main-thread path runs — so given the same command
 * stream the worker computes the same field, bit for bit.
 */
import type { WatershedNativeModule } from '../systems/water/WatershedWasm';
import { createWasmSweSim, type SweSim } from '../systems/water/sweSim';
import { simFrameByteLength, viewSimFrame } from './SimFrame';
import type { SimWorkerCommand, SimWorkerResponse, SurfaceOps } from './simWorkerProtocol';

/** Spare frame buffers kept for reuse; two cover the in-flight + next frame. */
const FRAME_POOL_LIMIT = 2;

export interface SimWorkerCore {
  handle(command: SimWorkerCommand): void;
  dispose(): void;
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
  const pool: ArrayBuffer[] = [];

  const live = (id: number): SweSim | null => (sim && id === gridId ? sim : null);

  const applySurface = (grid: SweSim, surface: SurfaceOps) => {
    for (let i = 0; i + 1 < surface.length; i += 2) grid.addSurface(surface[i], surface[i + 1]);
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
          buffer,
        },
      },
      [buffer],
    );
  };

  const disposeGrid = () => {
    sim?.dispose();
    sim = null;
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
        case 'SCROLL': {
          const grid = live(command.gridId);
          if (!grid) return;
          applySurface(grid, command.surface);
          grid.scroll(command.shiftX, command.shiftZ, command.inflow);
          epoch += 1;
          return;
        }
        case 'STEP': {
          const grid = live(command.gridId);
          if (!grid) return;
          applySurface(grid, command.surface);
          const t0 = now();
          grid.step(command.input);
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
      }
    },
    dispose() {
      disposeGrid();
      pool.length = 0;
    },
  };
}
