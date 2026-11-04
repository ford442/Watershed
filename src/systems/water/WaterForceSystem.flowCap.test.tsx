/**
 * #521 B acceptance: the current pushing the hull comes from the segment's
 * GameplayProfile, never from a biome palette.
 *
 * Mounts the real WaterForceSystem, captures its `useFrame`, and reads the flow
 * cap it hands the force bridge. The profile is produced the way the game does:
 * MapSystem resolves the segment's profile, the treadmill commits it, the
 * SimCore `gameplay-profile` system steps it in, then the frame runs.
 */
import React from 'react';
import { act, render } from '@testing-library/react';

const h = vi.hoisted(() => ({
  frame: null as null | ((state: { clock: { elapsedTime: number } }, delta: number) => void),
  flowSpeeds: [] as number[],
  segmentGameplay: null as unknown,
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
  bindHeightfieldChoreWorker: vi.fn(),
  runHeightfieldChores: vi.fn(),
}));

vi.mock('./wasmLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./wasmLoader')>()),
  // Never resolves: the field stays off, which is not what this test measures.
  getWasm: vi.fn(() => new Promise(() => {})),
}));

vi.mock('./sweBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sweBackend')>()),
  resolveSweSimBackendDecision: vi.fn(() => ({ backend: 'wasm-main', reason: 'sim-worker-disabled' })),
}));

vi.mock('./waterForceBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./waterForceBridge')>();
  return {
    ...actual,
    applyWaterForces: vi.fn((frame: { flowSpeed: number }) => {
      h.flowSpeeds.push(frame.flowSpeed);
      return {
        owner: 'main',
        vehicleFlow: { dirX: 0, dirZ: -1, speed: 0, surfaceOffset: 0, source: 'fallback', wet: true },
      };
    }),
  };
});

vi.mock('../map/ChunkManager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../map/ChunkManager')>()),
  // The live treadmill, having committed a canyonSummer segment whose profile is h.segmentGameplay.
  getLiveChunkManager: () => ({ getCurrentBiome: () => 'canyonSummer', getCommittedGameplay: () => h.segmentGameplay }),
}));

import { getBiomePalette } from '../../configs/BiomePalettes';
import { SimCore } from '../../sim/core/SimCore';
import { resetActiveGameplayProfileForTests } from '../gameplay/activeGameplayProfile';
import { createGameplayProfileSimSystem } from '../gameplay/gameplaySimSystem';
import { useGameStore } from '../GameState';
import { resolveGameplayProfile } from '../map/MapSystem';
import { clearFloatingWaterBodies } from './WaterForceRegistry';
import { WaterForceSystem } from './WaterForceSystem';

const vehicle = {
  translation: () => ({ x: 0, y: 0, z: 0 }),
  linvel: () => ({ x: 0, y: 0, z: -5 }),
  applyImpulse: () => {},
};

/** One sim step, then one water-force frame. */
function frameFlowCap(core: SimCore): number {
  core.step();
  act(() => h.frame!({ clock: { elapsedTime: 1 } }, 1 / 60));
  return h.flowSpeeds[h.flowSpeeds.length - 1];
}

describe('WaterForceSystem flow cap (#521 B)', () => {
  let core: SimCore;
  const summer = getBiomePalette('canyonSummer');
  const paletteFlow = summer.flowSpeed;

  beforeEach(() => {
    h.flowSpeeds.length = 0;
    resetActiveGameplayProfileForTests();
    clearFloatingWaterBodies();
    useGameStore.setState({ currentBiome: 'canyonSummer' });
    h.segmentGameplay = resolveGameplayProfile({ biome: 'canyonSummer' });
    core = new SimCore();
    core.register(createGameplayProfileSimSystem());
    render(<WaterForceSystem vehicleRef={{ current: vehicle as never }} />);
  });

  afterEach(() => {
    summer.flowSpeed = paletteFlow;
  });

  it('is the segment profile flow cap', () => {
    expect(frameFlowCap(core)).toBe(1.0);
  });

  it('does not change when the biome palette flowSpeed changes', () => {
    const before = frameFlowCap(core);
    summer.flowSpeed = paletteFlow * 4;
    expect(frameFlowCap(core)).toBe(before);
  });

  it('changes when the segment GameplayProfile changes', () => {
    expect(frameFlowCap(core)).toBe(1.0);
    h.segmentGameplay = resolveGameplayProfile({ biome: 'canyonSummer', gameplay: { flowCap: 2.5 } });
    expect(frameFlowCap(core)).toBe(2.5);
  });
});
