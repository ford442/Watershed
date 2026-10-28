import { describe, expect, it, vi } from 'vitest';
import { SimCore } from '../sim/core/SimCore';
import type { DebugStageController } from '../debug/debugStages';
import { createSimSystems } from './simSystems';

const debug = {
  isStageEnabled: () => true,
  setStageFailure: vi.fn(),
} as unknown as DebugStageController;

describe('the registered sim systems', () => {
  it('step in the documented order: weather, sky, chunk/biome, gameplay profile, survival, pillars, score', () => {
    const core = new SimCore();
    for (const system of createSimSystems(debug)) core.register(system);
    expect(core.getSystemIds()).toEqual([
      'weather-director',
      'sky-clock',
      'chunk-biome',
      'gameplay-profile',
      'survival',
      'pillars',
      'score',
    ]);
  });

  it('has unique ids and orders (an order tie would hide an ordering decision)', () => {
    const systems = createSimSystems(debug);
    expect(new Set(systems.map((s) => s.id)).size).toBe(systems.length);
    expect(new Set(systems.map((s) => s.order)).size).toBe(systems.length);
  });

  it('runs a full step on an idle context without throwing (no vehicle, no run, no treadmill)', () => {
    const core = new SimCore();
    for (const system of createSimSystems(debug)) core.register(system);
    expect(() => {
      for (let i = 0; i < 10; i += 1) core.step();
    }).not.toThrow();
  });
});
