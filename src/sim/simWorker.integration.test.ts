/**
 * simWorker.integration.test.ts — the worker field IS the main-thread field (#455).
 *
 * Two instances of the REAL binary: one behind `createWasmSweSim` (the
 * `wasm-main` backend), one behind the sim worker's core, reached through the
 * real proxy + `createWorkerSweSim` over a fake worker that structured-clones
 * every message with its transfer list (so a payload that cannot be cloned, or
 * a buffer touched after transfer, fails here). Both get the same stream —
 * bed commits, splashes, scrolls with a routed inflow, steps with every event
 * kind and a routed edge — and must agree bit for bit after every step.
 *
 * Gated like the other integration tests (`pnpm test:wasm`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WatershedNativeModule } from '../systems/water/WatershedWasm';
import { createWasmSweSim, type SweEventCall, type SweSim } from '../systems/water/sweSim';
import { SimWorkerProxy } from './createSimWorkerProxy';
import { createSimWorkerCore } from './simWorkerCore';
import type { SimWorkerCommand, SimWorkerLike, SimWorkerResponse } from './simWorkerProtocol';
import { createWorkerSweSim } from './workerSweSim';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const jsPath = resolve(publicDir, 'watershed_native.js');
const runIntegration = process.env.WATERSHED_WASM_INTEGRATION === '1' && existsSync(wasmPath);
const describeIntegration = runIntegration ? describe : describe.skip;

async function loadModule(): Promise<WatershedNativeModule> {
  const wasmBinary = readFileSync(wasmPath);
  const { default: create } = await import(/* @vite-ignore */ pathToFileURL(jsPath).href);
  return create({
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance) => void,
    ) => {
      WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) => receive(instance));
      return {};
    },
  });
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-process worker: commands and responses cross a structuredClone boundary
 * with their transfer lists, and are delivered only when the test pumps — the
 * main thread never sees a frame synchronously, as in a browser.
 */
function fakeWorker(wasm: WatershedNativeModule) {
  const toWorker: SimWorkerCommand[] = [];
  const toMain: SimWorkerResponse[] = [];
  const listeners = new Set<(event: MessageEvent<SimWorkerResponse>) => void>();
  const core = createSimWorkerCore(wasm, (response, transfer = []) => {
    toMain.push(structuredClone(response, { transfer }));
  });
  const worker = {
    postMessage(message: SimWorkerCommand, transfer: Transferable[] = []) {
      toWorker.push(structuredClone(message, { transfer: transfer as Transferable[] }));
    },
    addEventListener(type: string, listener: (event: MessageEvent<SimWorkerResponse>) => void) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: MessageEvent<SimWorkerResponse>) => void) {
      if (type === 'message') listeners.delete(listener);
    },
  } as unknown as SimWorkerLike;
  const pump = () => {
    while (toWorker.length || toMain.length) {
      for (const command of toWorker.splice(0)) core.handle(command);
      for (const response of toMain.splice(0)) {
        for (const listener of listeners) listener({ data: response } as MessageEvent<SimWorkerResponse>);
      }
    }
  };
  return { worker, pump };
}

function firstMismatch(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return i;
  }
  return -1;
}

describeIntegration('sim worker (wasm-worker) vs main-thread stepper (wasm-main) — real binary', () => {
  let wasmMain: WatershedNativeModule;
  let wasmWorker: WatershedNativeModule;

  beforeAll(async () => {
    [wasmMain, wasmWorker] = await Promise.all([loadModule(), loadModule()]);
  });

  it('handshakes with the module ABI', async () => {
    const { worker, pump } = fakeWorker(wasmWorker);
    const proxy = new SimWorkerProxy(worker);
    const ready = proxy.ready(1000);
    pump();
    await expect(ready).resolves.toBe(wasmWorker.getVersion());
  });

  it('computes the same field bit for bit through beds, splashes, scrolls, events and the routed edge', () => {
    const width = 48;
    const height = 32;
    const dx = 0.5;
    const H = 1;
    const count = width * height;
    const rand = mulberry32(455);

    const { worker, pump } = fakeWorker(wasmWorker);
    const proxy = new SimWorkerProxy(worker);
    const main: SweSim = createWasmSweSim(wasmMain, width, height, dx);
    const viaWorker: SweSim = createWorkerSweSim(proxy, width, height, dx);
    expect(viaWorker.backend).toBe('wasm-worker');
    pump();

    let originX = -12;
    let originZ = -8;

    const rasterize = () => {
      // A bumpy bed with a dry bank on one side, in world coordinates.
      for (let gz = 0; gz < height; gz += 1) {
        for (let gx = 0; gx < width; gx += 1) {
          const x = originX + gx * dx;
          const z = originZ + gz * dx;
          const bed = 0.15 * Math.sin(x * 0.7) * Math.cos(z * 0.4) + (x > 6 ? 1.4 : 0);
          main.b[gz * width + gx] = bed;
          viaWorker.b[gz * width + gx] = bed;
        }
      }
      main.commitBed();
      viaWorker.commitBed();
    };
    rasterize();

    for (let frame = 0; frame < 90; frame += 1) {
      if (frame % 7 === 3) {
        const shiftX = Math.floor(rand() * 5) - 2;
        const shiftZ = Math.floor(rand() * 4);
        const inflow = { eta: 0.05 * rand(), u: 0, w: -0.3 * rand() };
        main.scroll(shiftX, shiftZ, inflow);
        viaWorker.scroll(shiftX, shiftZ, inflow);
        originX -= shiftX * dx;
        originZ -= shiftZ * dx;
        rasterize();
      }

      for (let s = 0; s < 3; s += 1) {
        const idx = Math.floor(rand() * count);
        const amount = (rand() - 0.3) * 0.2;
        main.addSurface(idx, amount);
        viaWorker.addSurface(idx, amount);
        // Same cell twice: the ops must be applied one by one, not pre-summed.
        main.addSurface(idx, amount * 0.5);
        viaWorker.addSurface(idx, amount * 0.5);
      }

      const events: SweEventCall[] = [0, 1, 2, 3].map((kind) => ({
        kind,
        cx: originX + rand() * width * dx,
        cz: originZ + rand() * height * dx,
        radius: 2 + rand() * 4,
        strength: rand(),
        dt: 1 / 60,
      }));
      const input = {
        dt: 1 / 60,
        g: 9.80665,
        H,
        originX,
        originZ,
        events,
        edgeEta: frame % 2 === 0 ? 0.1 * rand() : undefined,
      };
      const versionBefore = viaWorker.fieldVersion;
      main.step(input);
      viaWorker.step(input);
      // A frame arrives a message later, never inside step().
      expect(viaWorker.fieldVersion).toBe(versionBefore);
      pump();
      expect(viaWorker.fieldVersion).toBe(versionBefore + 1);

      for (const plane of ['h', 'u', 'w', 'b'] as const) {
        const at = firstMismatch(main[plane], viaWorker[plane]);
        expect(at, `${plane} differs at cell ${at} on frame ${frame}`).toBe(-1);
      }
    }

    viaWorker.dispose();
    main.dispose();
    pump();
    expect(proxy.latestFrame()?.frameIndex).toBe(90);
  });

  it('drops a frame taken before a scroll instead of pairing it with the new window', () => {
    const width = 16;
    const height = 12;
    const { worker, pump } = fakeWorker(wasmWorker);
    const proxy = new SimWorkerProxy(worker);
    const sim = createWorkerSweSim(proxy, width, height, 0.5);
    pump();
    sim.addSurface(5 * width + 8, 0.3);
    sim.step({ dt: 1 / 60, g: 9.80665, H: 1, originX: 0, originZ: 0, events: [] });
    // Scroll before the step's frame lands: the frame is in the old index frame.
    const before = sim.fieldVersion;
    sim.scroll(0, 2);
    const scrolled = Float32Array.from(sim.h);
    pump();
    expect(sim.fieldVersion).toBe(before + 1); // the scroll, not the stale frame
    expect(firstMismatch(sim.h, scrolled)).toBe(-1);
    sim.dispose();
  });
});
