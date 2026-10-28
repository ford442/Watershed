/**
 * The biome cross-fade advances on sim time (the frame delta) and commits
 * React state once per progress step — never per rAF, never by wall clock.
 */

import { getBiomePalette } from '../../configs/BiomePalettes';
import { BIOME_TRANSITION_STEPS, advanceBiomeTransition } from './BiomeSystem';

function clockFor(durationSec: number) {
  return {
    from: getBiomePalette('canyonSummer'),
    to: getBiomePalette('glacier'),
    elapsedSec: 0,
    durationSec,
    active: true,
    step: 0,
  };
}

describe('advanceBiomeTransition', () => {
  it('commits BIOME_TRANSITION_STEPS times across a cross-fade stepped at 60 Hz', () => {
    const clock = clockFor(2);
    let commits = 0;
    let last = null as ReturnType<typeof advanceBiomeTransition>;
    for (let i = 0; i < 2 * 60 + 5; i += 1) {
      const next = advanceBiomeTransition(clock, 1 / 60);
      if (next) {
        commits += 1;
        last = next;
      }
    }
    expect(commits).toBe(BIOME_TRANSITION_STEPS);
    expect(last).not.toBeNull();
    expect(last!.isTransitioning).toBe(false);
    expect(last!.transitionProgress).toBe(1);
    expect(last!.currentBiome.id).toBe('glacier');
    expect(clock.active).toBe(false);
  });

  it('depends only on the deltas stepped, so equal sim time gives equal progress', () => {
    const a = clockFor(5);
    const b = clockFor(5);
    for (let i = 0; i < 90; i += 1) advanceBiomeTransition(a, 1 / 60);
    for (let i = 0; i < 3; i += 1) advanceBiomeTransition(b, 0.5);
    expect(a.step).toBe(b.step);
    expect(a.elapsedSec).toBeCloseTo(b.elapsedSec, 9);
  });

  it('interpolates flowSpeed between the two palettes mid-fade (visual only)', () => {
    const clock = clockFor(1);
    let mid = null as ReturnType<typeof advanceBiomeTransition>;
    for (let i = 0; i < 30; i += 1) mid = advanceBiomeTransition(clock, 1 / 60) ?? mid;
    expect(mid!.isTransitioning).toBe(true);
    expect(mid!.currentBiome.flowSpeed).toBeGreaterThan(getBiomePalette('canyonSummer').flowSpeed);
    expect(mid!.currentBiome.flowSpeed).toBeLessThan(getBiomePalette('glacier').flowSpeed);
  });

  it('settles at once for a zero duration and ignores an inactive clock', () => {
    const clock = clockFor(0);
    expect(advanceBiomeTransition(clock, 1 / 60)?.isTransitioning).toBe(false);
    expect(advanceBiomeTransition(clock, 1 / 60)).toBeNull();
  });
});
