/**
 * AudioManager.getFootstepSound (#503 D/F): `step_<material>` when the sound
 * library has it, else `step_rock`. The old `\`step_${m}\` || 'step_rock'`
 * could never fall back, so concrete / water / unknown materials asked for a
 * sound that does not exist.
 */
import { describe, expect, it } from 'vitest';
import { AudioManager } from './AudioSystem';
import { SOUND_DEFS } from './soundDefs';
import { SurfaceMaterial } from '../vehicle/VehicleSystem';

describe('AudioManager.getFootstepSound', () => {
  it('uses the material step when the library has one', () => {
    expect(AudioManager.getFootstepSound('moss', false)).toBe('step_moss');
    expect(AudioManager.getFootstepSound('wood', false)).toBe('step_wood');
  });

  it('wet feet win over the material', () => {
    expect(AudioManager.getFootstepSound('rock', true)).toBe('step_wet');
  });

  it('falls back to step_rock for materials without a step sound', () => {
    expect(AudioManager.getFootstepSound('concrete', false)).toBe('step_rock');
    expect(AudioManager.getFootstepSound('lava', false)).toBe('step_rock');
  });

  it('every surface material resolves to a sound that exists', () => {
    for (const material of Object.values(SurfaceMaterial)) {
      expect(SOUND_DEFS[AudioManager.getFootstepSound(material, false)]).toBeDefined();
    }
  });
});
