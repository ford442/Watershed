import { describe, expect, it, vi } from 'vitest';
import { SimCore } from '../../sim/core/SimCore';

const run = vi.hoisted(() => ({ levelData: { hazards: [] as unknown[] } }));

vi.mock('../journey/runSession', () => ({
  getRunMap: () => ({ levelData: run.levelData }),
  shockRunSurvival: vi.fn(),
}));

describe('hazards sim system — lazy per map (#522 A)', () => {
  it('a map with no hazards never fetches the runtime and is settled', async () => {
    const { createHazardSimSystem, isHazardRuntimeSettled } = await import('./hazardSimSystem');
    const core = new SimCore();
    core.register(createHazardSimSystem());
    for (let i = 0; i < 30; i += 1) core.step();
    expect(isHazardRuntimeSettled()).toBe(true);
  });

  it('a hazard map is unsettled until the runtime resolves, then steps', async () => {
    const { createHazardSimSystem, isHazardRuntimeSettled, loadHazardRuntime } = await import('./hazardSimSystem');
    run.levelData = {
      hazards: [{ id: 'jam', kind: 'logJam', segmentIndex: 1, trigger: { type: 'delay', seconds: 0 } }],
    };
    const core = new SimCore();
    core.register(createHazardSimSystem());
    expect(isHazardRuntimeSettled()).toBe(false); // starts the fetch
    await loadHazardRuntime();
    expect(isHazardRuntimeSettled()).toBe(true);
    expect(() => core.step()).not.toThrow();
  });
});
