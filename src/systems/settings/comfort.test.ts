import { describe, expect, it } from 'vitest';
import {
  FOV_DEFAULT,
  FOV_MAX,
  FOV_MIN,
  clampFov,
  deriveComfort,
  raftTargetFov,
  resolveReducedMotion,
  runnerTargetFov,
  type ComfortInput,
} from './comfort';
import { RAFT } from '../../constants/game';

const base: ComfortInput = {
  fov: 75,
  fovKick: 1,
  cameraShake: 1,
  speedEffects: true,
  vignetteStrength: 1,
  reducedMotion: 'system',
};

describe('reduced motion', () => {
  it('follows the OS flag by default and can be forced either way', () => {
    expect(resolveReducedMotion('system', true)).toBe(true);
    expect(resolveReducedMotion('system', false)).toBe(false);
    expect(resolveReducedMotion('on', false)).toBe(true);
    expect(resolveReducedMotion('off', true)).toBe(false);
  });

  it('prefers-reduced-motion: reduce disables shake, FOV kick and speed effects by default', () => {
    const c = deriveComfort(base, true);
    expect(c.reducedMotion).toBe(true);
    expect(c.shake).toBe(0);
    expect(c.fovKick).toBe(0);
    expect(c.speedEffects).toBe(false);
    // Comfort that is not motion is left alone.
    expect(c.fovBase).toBe(75);
    expect(c.vignette).toBe(1);
  });

  it('the player can opt back in with reduced motion Off', () => {
    const c = deriveComfort({ ...base, reducedMotion: 'off' }, true);
    expect(c.shake).toBe(1);
    expect(c.speedEffects).toBe(true);
  });

  it('applies the stored values untouched when the OS asks for nothing', () => {
    const c = deriveComfort({ ...base, cameraShake: 0.4, fovKick: 0.5, speedEffects: false, vignetteStrength: 0.25, fov: 100 }, false);
    expect(c).toEqual({ reducedMotion: false, fovBase: 100, fovKick: 0.5, shake: 0.4, speedEffects: false, vignette: 0.25 });
  });
});

describe('FOV', () => {
  it('keeps the shipped default at 75 and the range at 70–110', () => {
    expect(FOV_DEFAULT).toBe(75);
    expect(RAFT.CAMERA_FOV_BASE).toBe(FOV_DEFAULT);
    expect(clampFov(10)).toBe(FOV_MIN);
    expect(clampFov(500)).toBe(FOV_MAX);
    expect(clampFov(Number.NaN)).toBe(FOV_DEFAULT);
  });

  it('runner target matches the authored curve at the defaults', () => {
    const c = deriveComfort(base, false);
    expect(runnerTargetFov(0, false, c)).toBe(75);
    expect(runnerTargetFov(10, false, c)).toBeCloseTo(75 + 4.5);
    expect(runnerTargetFov(100, false, c)).toBe(75 + 12);
    expect(runnerTargetFov(100, true, c)).toBe(75 + 22);
  });

  it('base FOV shifts the whole curve and the kick slider scales only the kick', () => {
    const wide = deriveComfort({ ...base, fov: 100, fovKick: 0.5 }, false);
    expect(runnerTargetFov(0, false, wide)).toBe(100);
    expect(runnerTargetFov(100, false, wide)).toBeCloseTo(100 + 6);
    expect(runnerTargetFov(100, true, deriveComfort({ ...base, fovKick: 0 }, false))).toBe(75);
  });

  it('raft target equals the authored min(FOV_MAX, base + speed term) at the defaults', () => {
    const c = deriveComfort(base, false);
    const maxKick = RAFT.CAMERA_FOV_MAX - RAFT.CAMERA_FOV_BASE;
    for (const speed of [0, 5, 15, 60]) {
      const authored = Math.min(RAFT.CAMERA_FOV_MAX, RAFT.CAMERA_FOV_BASE + (speed / 15) * RAFT.CAMERA_FOV_SPEED_SCALE);
      expect(raftTargetFov(speed, 15, RAFT.CAMERA_FOV_SPEED_SCALE, maxKick, c)).toBeCloseTo(authored);
    }
  });
});
