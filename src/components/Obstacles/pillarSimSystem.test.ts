import { beforeEach, describe, expect, it } from 'vitest';
import { SIM_DT, SimCore } from '../../sim/core/SimCore';
import { PILLAR_CRACK_DURATION_S } from './pillarCrumble';
import { createPillarSimSystem } from './pillarSimSystem';
import {
  beginPillarCrack,
  cancelPillarCrack,
  getPillarFragmentClock,
} from './pillarSimClock';

const CRACK_STEPS = Math.ceil(PILLAR_CRACK_DURATION_S / SIM_DT - 1e-9);

describe('pillars sim system', () => {
  let core: SimCore;
  beforeEach(() => {
    core = new SimCore();
    core.register(createPillarSimSystem());
    core.reset();
  });

  it('shatters a cracking pillar after PILLAR_CRACK_DURATION_S of sim time, once', () => {
    let shattered = 0;
    const crack = beginPillarCrack('7:2', () => void (shattered += 1));
    for (let i = 0; i < CRACK_STEPS - 1; i += 1) core.step();
    expect(shattered).toBe(0);
    expect(crack.elapsedSec).toBeCloseTo((CRACK_STEPS - 1) * SIM_DT, 9);
    core.step();
    expect(shattered).toBe(1);
    for (let i = 0; i < 30; i += 1) core.step();
    expect(shattered).toBe(1);
  });

  it('the shatter lands on the same step whatever the render cadence', () => {
    const stepOfShatter = (frameDelta: number) => {
      const c = new SimCore();
      c.register(createPillarSimSystem());
      let at = -1;
      beginPillarCrack('k', () => void (at = c.ctx.stepIndex));
      for (let i = 0; i < 400 && at < 0; i += 1) c.advance(frameDelta);
      return at;
    };
    const reference = stepOfShatter(SIM_DT);
    expect(reference).toBe(CRACK_STEPS);
    expect(stepOfShatter(0.005)).toBe(reference);
    expect(stepOfShatter(0.04)).toBe(reference);
  });

  it('a cancelled crack (the pillar unmounted) never shatters', () => {
    let shattered = 0;
    beginPillarCrack('gone', () => void (shattered += 1));
    cancelPillarCrack('gone');
    for (let i = 0; i < 30; i += 1) core.step();
    expect(shattered).toBe(0);
  });

  it('a run reset drops cracks in flight', () => {
    let shattered = 0;
    beginPillarCrack('mid', () => void (shattered += 1));
    core.step();
    core.reset();
    for (let i = 0; i < 30; i += 1) core.step();
    expect(shattered).toBe(0);
  });

  it('ages the debris clock by the fixed step', () => {
    const before = getPillarFragmentClock();
    for (let i = 0; i < 120; i += 1) core.step();
    expect(getPillarFragmentClock() - before).toBeCloseTo(120 * SIM_DT, 9);
  });
});
