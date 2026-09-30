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
 * Phase B: the router moves into the worker (ROUTER + chain index on SCROLL /
 * STEP) and forces are computed there on the stepped field (FORCES, and HULL
 * over a real MessageChannel as the Rapier worker sends it). Both must equal
 * what the main thread computes on its own stepper's field — the router via
 * createRiverRouter on the main module, forces via sampleSWEFlow +
 * computeWaterForcesBatch and via calculateWaterForce (the wasm-main loop) —
 * bit for bit.
 *
 * Gated like the other integration tests (`pnpm test:wasm`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createWaterForceBatch,
  type NativeWaterForceConfig,
  type NativeWaterForceResult,
  type WatershedNativeModule,
} from '../systems/water/WatershedWasm';
import { createWasmSweSim, type SweEventCall, type SweSim } from '../systems/water/sweSim';
import { SWE_REST_INFLOW } from '../systems/water/sweScroll';
import { createRiverRouter, routedEdgeInflow } from '../systems/water/riverRouter';
import { getRoutingReach } from '../systems/map/routingReach';
import { DEFAULT_FORECAST_INPUTS } from '../constants/forecast';
import {
  SWE_STAGE_SPEED_BOOST,
  sampleSWEFlow,
  stagedWaterLevel,
  type SWEFlowGrid,
} from '../systems/water/sampleSWEFlow';
import {
  FORCE_SAMPLE_STRIDE,
  readForceFlow,
  readForceResult,
  writeForceSample,
} from './simForces';
import type { SimForceResult } from './simWorkerProtocol';
import { createHullLinkClient, type RapierHullPort } from '../physics/hullLinkClient';
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

  describe('Phase B — router and forces in the worker', () => {
    const width = 48;
    const height = 32;
    const dx = 0.5;
    const H = 1;
    const g = 9.80665;

    /** Hull and debris configs as WaterForceSystem builds them (raft / runner / debris). */
    const BODY_CONFIGS: { config: NativeWaterForceConfig; flowScale: number }[] = [
      {
        config: {
          flowSpeed: 0, waterLevel: 0.5, raftMass: 150, raftVolume: 1.2, dragCoefficient: 0.47,
          frontalArea: 1.05, sideArea: 0.7, timeSeconds: 0, turbulenceStrength: 0.1, turbulenceFrequency: 2.4,
        },
        flowScale: 1,
      },
      {
        config: {
          flowSpeed: 0, waterLevel: 0.5, raftMass: 82, raftVolume: 0.08, dragCoefficient: 1,
          frontalArea: 0.45, sideArea: 0.35, timeSeconds: 0, turbulenceStrength: 0.075, turbulenceFrequency: 2.4,
        },
        flowScale: 1,
      },
      {
        config: {
          flowSpeed: 0, waterLevel: 0.5, raftMass: 0.021, raftVolume: 0.03, dragCoefficient: 0.8,
          frontalArea: 0.12, sideArea: 0.072, timeSeconds: 0, turbulenceStrength: 0.08, turbulenceFrequency: 2.4,
        },
        flowScale: 0.6,
      },
    ];

    /** Fixture bodies relative to the window: channel, dry bank, straddling the edge, outside it. */
    function bodiesAt(originX: number, originZ: number, t: number, rand: () => number) {
      const at = [
        [8, 10], [20.3, 15.7], [30, 4], [40.5, 20], [47.5, 31.2], [-3, 12], [24, 40],
      ];
      return at.map(([gx, gz], i) => ({
        position: { x: originX + gx * dx + 0.013 * i, y: 0.1 + 0.6 * rand(), z: originZ + gz * dx - 0.007 * i },
        velocity: { x: rand() - 0.5, y: 0.2 * (rand() - 0.5), z: -2 * rand() },
        ...BODY_CONFIGS[i % BODY_CONFIGS.length],
        timeSeconds: t,
        flowSpeed: 1.2 + 0.4 * rand(),
      }));
    }

    function flowGridOf(sim: SweSim, originX: number, originZ: number): SWEFlowGrid {
      return { h: sim.h, u: sim.u, w: sim.w, b: sim.b, width, height, cellSize: dx, originX, originZ };
    }

    /** The main-thread references: one computeWaterForcesBatch per body, and calculateWaterForce. */
    function mainThreadForces(
      wasm: WatershedNativeModule,
      grid: SWEFlowGrid,
      body: ReturnType<typeof bodiesAt>[number],
    ): { batched: NativeWaterForceResult; single: NativeWaterForceResult; flow: ReturnType<typeof sampleSWEFlow> } {
      const flow = sampleSWEFlow({
        worldX: body.position.x,
        worldZ: body.position.z,
        flowSpeed: body.flowSpeed,
        grid,
        enabled: true,
        stageSpeedBoost: SWE_STAGE_SPEED_BOOST,
      });
      const config: NativeWaterForceConfig = {
        ...body.config,
        timeSeconds: body.timeSeconds,
        flowSpeed: flow.speed * body.flowScale,
        waterLevel: stagedWaterLevel(body.config.waterLevel, flow),
      };
      const batch = createWaterForceBatch(wasm, 1);
      batch.setSample(0, {
        position: body.position,
        velocity: body.velocity,
        flowDirection: { x: flow.dirX, z: flow.dirZ },
      });
      batch.compute(config);
      const batched = batch.readResult(0);
      batch.dispose();
      const single = wasm.calculateWaterForce(
        body.position.x, body.position.y, body.position.z,
        body.velocity.x, body.velocity.y, body.velocity.z,
        flow.dirX, flow.dirZ,
        config.flowSpeed, config.waterLevel, config.raftMass, config.raftVolume, config.dragCoefficient,
        config.frontalArea, config.sideArea, config.timeSeconds, config.turbulenceStrength, config.turbulenceFrequency,
      );
      return { batched, single, flow };
    }

    function expectSameForce(got: NativeWaterForceResult, want: NativeWaterForceResult, label: string) {
      for (const key of Object.keys(want) as (keyof NativeWaterForceResult)[]) {
        expect(Object.is(got[key], want[key]), `${label}.${key}: ${got[key]} vs ${want[key]}`).toBe(true);
      }
    }

    it('routes in the worker and computes forces on its field, bit for bit with the main thread', () => {
      const rand = mulberry32(4552);
      const reach = getRoutingReach();
      const launchHour = 14;
      const mainRouter = createRiverRouter(wasmMain, reach, launchHour, { forecast: DEFAULT_FORECAST_INPUTS })!;
      expect(mainRouter).not.toBeNull();

      const { worker, pump } = fakeWorker(wasmWorker);
      const proxy = new SimWorkerProxy(worker);
      const main = createWasmSweSim(wasmMain, width, height, dx);
      const viaWorker = createWorkerSweSim(proxy, width, height, dx);
      proxy.post({ type: 'ROUTER', reach, launchHour, forecast: DEFAULT_FORECAST_INPUTS, H, g });
      const results: SimForceResult[] = [];
      proxy.onForces((result) => results.push(result));
      pump();

      let originX = -12;
      let originZ = -8;
      const rasterize = () => {
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

      let forceChecks = 0;
      let routedFrames = 0;
      let sweSamples = 0;
      for (let frame = 0; frame < 60; frame += 1) {
        // Off the chain now and then (null), otherwise walk down it.
        const chainIndex = frame % 11 === 5 ? null : Math.min(reach.segments.length - 1, Math.floor(frame / 6));
        const routed = routedEdgeInflow(mainRouter, chainIndex, H, g);
        const fill = routed?.inflow ?? SWE_REST_INFLOW;
        if (routed && routed.edgeEta !== 0) routedFrames += 1;

        if (frame === 0) {
          // A freshly placed window: filled only when a routed state exists.
          if (routed) main.scroll(width, 0, fill);
          viaWorker.scrollRouted(width, 0, { chainIndex }, true, originX, originZ);
          rasterize();
        } else if (frame % 7 === 3) {
          const shiftX = Math.floor(rand() * 5) - 2;
          const shiftZ = 1 + Math.floor(rand() * 3);
          originX -= shiftX * dx;
          originZ -= shiftZ * dx;
          main.scroll(shiftX, shiftZ, fill);
          viaWorker.scrollRouted(shiftX, shiftZ, { chainIndex }, false, originX, originZ);
          rasterize();
        }
        viaWorker.setOrigin(originX, originZ);

        const splash = Math.floor(rand() * width * height);
        main.addSurface(splash, 0.08);
        viaWorker.addSurface(splash, 0.08);
        const events: SweEventCall[] = [{
          kind: frame % 4, cx: originX + 12, cz: originZ + 8, radius: 3, strength: 0.5, dt: 1 / 60,
        }];
        const input = { dt: 1 / 60, g, H, originX, originZ, events };
        mainRouter.advance(input.dt);
        main.step({ ...input, edgeEta: routed?.edgeEta });
        viaWorker.stepRouted(input, { chainIndex });

        // Forces after the step, on the stepped field — as the frame posts them.
        const bodies = bodiesAt(originX, originZ, frame / 60, rand);
        const samples = new Float64Array(bodies.length * FORCE_SAMPLE_STRIDE);
        bodies.forEach((body, i) =>
          writeForceSample(samples, i, body, { ...body.config, timeSeconds: body.timeSeconds }, body.flowSpeed, body.flowScale),
        );
        proxy.requestForces(viaWorker.gridId, originX, originZ, samples, bodies.length);
        pump();

        for (const plane of ['h', 'u', 'w', 'b'] as const) {
          const at = firstMismatch(main[plane], viaWorker[plane]);
          expect(at, `${plane} differs at cell ${at} on frame ${frame}`).toBe(-1);
        }
        const result = results.shift()!;
        expect(result.count).toBe(bodies.length);
        const grid = flowGridOf(main, originX, originZ);
        bodies.forEach((body, i) => {
          const want = mainThreadForces(wasmMain, grid, body);
          const got = readForceResult(result.results, i);
          expectSameForce(got, want.batched, `frame ${frame} body ${i} vs batch`);
          expectSameForce(got, want.single, `frame ${frame} body ${i} vs calculateWaterForce`);
          expect(readForceFlow(result.results, i)).toEqual(want.flow);
          if (want.flow.source === 'swe' && want.flow.wet) sweSamples += 1;
          forceChecks += 1;
        });
      }
      // The run exercised both the swe sample and the fallback (outside the window), wet and dry.
      expect(forceChecks).toBe(60 * 7);
      expect(routedFrames).toBeGreaterThan(40);
      expect(sweSamples).toBeGreaterThan(60);
      viaWorker.dispose();
      main.dispose();
      mainRouter.dispose();
      proxy.post({ type: 'DISPOSE_ROUTER' });
      pump();
    });

    it('answers the Rapier worker\'s hull over a MessageChannel with the main-thread force', async () => {
      const { worker, pump } = fakeWorker(wasmWorker);
      const proxy = new SimWorkerProxy(worker);
      const main = createWasmSweSim(wasmMain, width, height, dx);
      const viaWorker = createWorkerSweSim(proxy, width, height, dx);
      const originX = 3;
      const originZ = -20;
      for (let i = 0; i < width * height; i += 1) {
        const bed = (i % width) > 40 ? 1.3 : 0.05 * Math.sin(i);
        main.b[i] = bed;
        viaWorker.b[i] = bed;
      }
      main.commitBed();
      viaWorker.commitBed();
      viaWorker.setOrigin(originX, originZ);
      for (let frame = 0; frame < 12; frame += 1) {
        const events: SweEventCall[] = [{ kind: 0, cx: originX + 10, cz: originZ + 6, radius: 3, strength: 0.8, dt: 1 / 60 }];
        const input = { dt: 1 / 60, g, H, originX, originZ, events, edgeEta: 0.04 };
        main.step(input);
        viaWorker.step(input);
      }

      const channel = new MessageChannel();
      proxy.connectPhysics(channel.port1);
      pump();
      const client = createHullLinkClient(channel.port2 as unknown as RapierHullPort);
      const state = {
        position: [originX + 9.37, 0.31, originZ + 7.11] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        velocity: [0.4, -0.05, -1.7] as [number, number, number],
        angularVelocity: [0, 0, 0] as [number, number, number],
      };
      const tick = {
        enabled: true, flowSpeed: 1.5, waterLevel: 0.5, raftMass: 150, raftVolume: 1.2, dragCoefficient: 0.47,
        frontalArea: 1.05, sideArea: 0.7, timeSeconds: 7.25, turbulenceStrength: 0.1, turbulenceFrequency: 2.4,
        flowDirX: 0, flowDirZ: -1, simFlow: true,
      };
      client.postHull(state, tick);
      for (let i = 0; i < 200 && !client.latestForce(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const got = client.latestForce();
      expect(got?.source).toBe('wasm');

      const want = mainThreadForces(wasmMain, flowGridOf(main, originX, originZ), {
        position: { x: state.position[0], y: state.position[1], z: state.position[2] },
        velocity: { x: state.velocity[0], y: state.velocity[1], z: state.velocity[2] },
        config: { ...tick },
        flowScale: 1,
        timeSeconds: tick.timeSeconds,
        flowSpeed: tick.flowSpeed,
      });
      expect(want.flow.source).toBe('swe');
      const { source: _s, computeMicros: _c, sampledFlow, ...force } = got!;
      expectSameForce(force, want.single, 'hull');
      expect(sampledFlow).toEqual(want.flow);

      client.close();
      channel.port1.close();
      viaWorker.dispose();
      main.dispose();
      pump();
    });
  });
});
