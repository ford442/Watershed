/**
 * WaterForceSystem × sim worker (#455 Phase A) — the backend wiring, on the real
 * component.
 *
 * Two stub modules: one is the main-thread module (forces, router, chores), the
 * other sits behind the sim worker's core. Pins that on the `wasm-worker`
 * backend the main thread never steps the field itself, that the surface is
 * uploaded from the worker's frames, that a failed handshake falls back to the
 * main-thread stepper with a warning, and that a worker dying mid-session turns
 * SWE off rather than starting a second field.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import * as THREE from 'three';
import type { WatershedNativeModule } from './WatershedWasm';
import type { SimWorkerCommand, SimWorkerLike, SimWorkerResponse } from '../../sim/simWorkerProtocol';

const h = vi.hoisted(() => ({
  frame: null as null | ((state: { clock: { elapsedTime: number } }, delta: number) => void),
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: typeof h.frame) => {
    h.frame = cb;
  },
}));

vi.mock('../GameState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../GameState')>()),
  useQualityPreset: () => 'high',
}));

vi.mock('../../rendering/gpuChores', () => ({
  bindChoreWasm: vi.fn(),
  runHeightfieldChores: vi.fn(),
}));

vi.mock('./bathymetrySampler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bathymetrySampler')>()),
  sampleBathymetryInto: vi.fn((out: Float32Array, _x: number, _z: number, _c: number, w: number, hh: number) => {
    out.fill(0.25);
    return w * hh;
  }),
}));

vi.mock('./WatershedWasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./WatershedWasm')>()),
  getWasm: vi.fn(),
}));

vi.mock('./sweBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sweBackend')>()),
  resolveSweSimBackendDecision: vi.fn(() => ({ backend: 'wasm-worker', reason: 'no-webgpu-device' })),
  demoteSweSimBackendToWasmMain: vi.fn(),
}));

vi.mock('../../sim/createSimWorkerProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sim/createSimWorkerProxy')>()),
  getSimWorkerProxy: vi.fn(),
}));

import { getWasm } from './WatershedWasm';
import { demoteSweSimBackendToWasmMain } from './sweBackend';
import { getSWEHeightFieldSnapshot } from './SWEHeightField';
import { getPhysicsWorkerStatus } from '../../physics/physicsWorkerRegistry';
import { SimWorkerProxy, getSimWorkerProxy } from '../../sim/createSimWorkerProxy';
import { createSimWorkerCore } from '../../sim/simWorkerCore';
import { WaterForceSystem } from './WaterForceSystem';

/** Heap-backed stand-in for the native module. `step` raises η at one cell. */
function stubModule(stepMarker: number) {
  const heap = new Float32Array(1 << 18);
  let next = 16;
  const mod = {
    HEAPF32: heap,
    getVersion: () => 11,
    allocateGrid: (count: number) => {
      const ptr = next * 4;
      next += count;
      return ptr;
    },
    freeGrid: () => {},
    stepShallowWater: vi.fn((hp: number) => {
      heap[hp >> 2] = stepMarker;
    }),
    applySWEEvent: vi.fn(),
    scrollShallowWater: vi.fn(),
    calculateWaterForce: vi.fn(() => ({
      forceX: 0, forceY: 0, forceZ: 0, buoyancy: 0, drag: 0, flow: 0, turbulence: 0, submergedRatio: 0,
    })),
  };
  return mod as unknown as WatershedNativeModule & typeof mod;
}

/** Worker around the real core; messages are delivered when the test pumps. */
function fakeWorker(wasm: WatershedNativeModule) {
  const toWorker: SimWorkerCommand[] = [];
  const toMain: SimWorkerResponse[] = [];
  const listeners = new Set<(event: MessageEvent<SimWorkerResponse>) => void>();
  const core = createSimWorkerCore(wasm, (response) => {
    toMain.push(response);
  });
  const worker = {
    postMessage: (message: SimWorkerCommand) => {
      toWorker.push(message);
    },
    terminate: vi.fn(),
    addEventListener: (type: string, l: (event: MessageEvent<SimWorkerResponse>) => void) => {
      if (type === 'message') listeners.add(l);
    },
    removeEventListener: (type: string, l: (event: MessageEvent<SimWorkerResponse>) => void) => {
      if (type === 'message') listeners.delete(l);
    },
  } as unknown as SimWorkerLike;
  const deliver = (response: SimWorkerResponse) => {
    for (const l of listeners) l({ data: response } as MessageEvent<SimWorkerResponse>);
  };
  const pump = () => {
    while (toWorker.length || toMain.length) {
      for (const c of toWorker.splice(0)) core.handle(c);
      for (const r of toMain.splice(0)) deliver(r);
    }
  };
  return { worker, pump, deliver };
}

function vehicle() {
  const pos = { x: 0, y: 1, z: 0 };
  return {
    current: {
      translation: () => pos,
      linvel: () => ({ x: 0, y: 0, z: 0 }),
      applyImpulse: vi.fn(),
    },
  };
}

let clock = 0;
function frame(delta = 1 / 30) {
  clock += delta;
  act(() => {
    h.frame!({ clock: { elapsedTime: clock } }, delta);
  });
}

async function mount(mainModule: WatershedNativeModule) {
  vi.mocked(getWasm).mockResolvedValue(mainModule);
  let unmount = () => {};
  await act(async () => {
    unmount = render(<WaterForceSystem vehicleRef={vehicle() as never} />).unmount;
    await Promise.resolve();
  });
  // The worker proxy resolves on a later microtask; let the effect install it.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return unmount;
}

function uploadedHeight(): Float32Array {
  const snap = getSWEHeightFieldSnapshot();
  return (snap.texture as THREE.DataTexture).image.data as unknown as Float32Array;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('WaterForceSystem on the wasm-worker backend', () => {
  it('never steps the field on the main thread, and uploads the worker frame', async () => {
    const main = stubModule(1);
    const inWorker = stubModule(7);
    const { worker, pump } = fakeWorker(inWorker);
    const proxy = new SimWorkerProxy(worker);
    vi.mocked(getSimWorkerProxy).mockResolvedValue(proxy);

    const unmount = await mount(main);
    expect(getPhysicsWorkerStatus().sweGrid).toMatch(/wasm-worker$/);

    for (let i = 0; i < 5; i += 1) {
      frame();
      pump();
    }
    frame(); // upload the last frame that landed

    expect(main.stepShallowWater).not.toHaveBeenCalled();
    expect(main.applySWEEvent).not.toHaveBeenCalled();
    expect(inWorker.stepShallowWater).toHaveBeenCalled();
    expect(uploadedHeight()[0]).toBe(7);
    unmount();
  });

  it('falls back to the main-thread stepper, with a warning, when the handshake fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const main = stubModule(3);
    vi.mocked(getSimWorkerProxy).mockRejectedValue(new Error('Worker is not a constructor'));

    const unmount = await mount(main);
    frame();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('sim worker unavailable'),
      expect.any(Error),
    );
    expect(demoteSweSimBackendToWasmMain).toHaveBeenCalled();
    expect(getPhysicsWorkerStatus().sweGrid).toMatch(/wasm-main$/);
    expect(main.stepShallowWater).toHaveBeenCalled();
    unmount();
  });

  it('turns SWE off when the worker dies mid-session instead of starting a second field', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const main = stubModule(1);
    const { worker, pump, deliver } = fakeWorker(stubModule(7));
    const proxy = new SimWorkerProxy(worker);
    vi.mocked(getSimWorkerProxy).mockResolvedValue(proxy);

    const unmount = await mount(main);
    frame();
    pump();
    act(() => deliver({ type: 'ERROR', error: 'RuntimeError: memory access out of bounds', fatal: true }));

    expect(getSWEHeightFieldSnapshot().enabled).toBe(false);
    expect(getPhysicsWorkerStatus().sweEnabled).toBe(false);
    frame();
    expect(main.stepShallowWater).not.toHaveBeenCalled();
    unmount();
  });
});
