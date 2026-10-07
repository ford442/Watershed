/**
 * Splash and waterfall mounts per backend: a native-WebGPU session never
 * reaches the WASM factory; `?simWorker=0` integrates on the main-thread
 * module; a sim-worker session posts to the worker instead (one module).
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  frames: [] as ((state: unknown, delta: number) => void)[],
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    h.frames.push(cb);
  },
}));

vi.mock('../lod/LODManager', () => ({
  useLOD: () => ({ config: { particleDensity: 1, maxParticles: 500 } }),
}));

vi.mock('../biome/BiomeSystem', () => ({
  useBiomeMaterials: () => ({ water: { foamColor: '#ffffff' } }),
}));

vi.mock('../../components/NonEmptyInstancedMesh', () => ({
  NonEmptyInstancedMesh: () => null,
}));

vi.mock('./SWEHeightField', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./SWEHeightField')>()),
  injectSWEDisturbance: vi.fn(),
}));

vi.mock('./WatershedWasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./WatershedWasm')>()),
  getWasm: vi.fn(),
}));

vi.mock('./sweBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sweBackend')>()),
  resolveSweSimBackendDecision: vi.fn(),
}));

vi.mock('../../sim/createSimWorkerProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sim/createSimWorkerProxy')>()),
  getSimWorkerProxy: vi.fn(),
}));

import { getWasm } from './WatershedWasm';
import { resolveSweSimBackendDecision, type SweSimBackend } from './sweBackend';
import { SimWorkerProxy, getSimWorkerProxy } from '../../sim/createSimWorkerProxy';
import type { SimWorkerCommand, SimWorkerLike } from '../../sim/simWorkerProtocol';
import { stubNativeModule } from '../../testing/stubNativeModule';
import { SplashSystem } from './SplashSystem';
import WaterfallParticles from '../../components/Environment/WaterfallParticles';

function decide(backend: SweSimBackend) {
  vi.mocked(resolveSweSimBackendDecision).mockReturnValue({ backend, reason: 'native-webgpu' });
}

/** A player sitting in the water, moving: an entry splash and cruise spray. */
function player() {
  return {
    current: {
      translation: () => ({ x: 0, y: 0.3, z: 0 }),
      linvel: () => ({ x: 6, y: 0, z: 0 }),
    },
  };
}

async function mountBoth() {
  let unmount = () => {};
  await act(async () => {
    unmount = render(
      <>
        <SplashSystem playerRef={player() as never} waterLevel={0.5} />
        <WaterfallParticles count={300} />
      </>,
    ).unmount;
  });
  // Let resolveNativeOwner settle and the integrators install.
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  return unmount;
}

function frames(n: number) {
  for (let i = 0; i < n; i += 1) {
    act(() => {
      for (const frame of h.frames) frame({ clock: { elapsedTime: i / 30 } }, 1 / 30);
    });
  }
}

afterEach(() => {
  h.frames.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('particles and the session\'s one module', () => {
  it('native WebGPU: splash + waterfall mount and run without invoking the WASM factory', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // <group> etc. in react-dom
    decide('wgsl');
    const unmount = await mountBoth();
    frames(5);
    expect(getWasm).not.toHaveBeenCalled();
    expect(getSimWorkerProxy).not.toHaveBeenCalled();
    unmount();
  });

  it('?simWorker=0: the main-thread module integrates the splash (kill switch)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    decide('wasm-main');
    const { mod } = stubNativeModule();
    vi.mocked(getWasm).mockResolvedValue(mod);
    const unmount = await mountBoth();
    frames(3);
    expect(getSimWorkerProxy).not.toHaveBeenCalled();
    expect(mod.stepSplashParticles).toHaveBeenCalled();
    expect(mod.initWaterfallParticles).toHaveBeenCalledTimes(1);
    unmount();
    expect(mod.freeParticleSoA).toHaveBeenCalled();
  });

  it('sim worker: splash and waterfall post to the worker; nothing loads here', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    decide('wasm-worker');
    const posted: SimWorkerCommand['type'][] = [];
    const worker = {
      postMessage: (command: SimWorkerCommand) => posted.push(command.type),
      terminate: vi.fn(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as SimWorkerLike;
    vi.mocked(getSimWorkerProxy).mockResolvedValue(new SimWorkerProxy(worker));
    const unmount = await mountBoth();
    frames(2);
    expect(getWasm).not.toHaveBeenCalled();
    expect(posted).toContain('PARTICLES_ALLOC');
    expect(posted).toContain('PARTICLES_INIT_WATERFALL');
    expect(posted).toContain('PARTICLES_STEP_SPLASH');
    unmount();
    expect(posted).toContain('PARTICLES_FREE');
  });
});
