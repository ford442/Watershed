import * as THREE from 'three';
import { qualityToEffects } from '../../systems/settings/settingsDerive';
import {
  DEFAULT_POST_TUNING,
  computePostFrameParams,
  createPostSmoothedState,
  godRaysAllowed,
  type PostFrameInput,
} from './postFrameParams';

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();
  return camera;
}

function makeInput(overrides: Partial<PostFrameInput> = {}): PostFrameInput {
  return {
    delta: 1 / 60,
    elapsed: 10,
    velocity: 0,
    waterfallIntensity: 0,
    isTightCanyon: false,
    biomeId: 'canyonSummer',
    weatherType: 'clear',
    timeOfDay: 0.5,
    sunWorldPosition: new THREE.Vector3(0, 40, -100),
    camera: makeCamera(),
    quality: 'high',
    enableGodRays: true,
    volumetricSamples: 48,
    effectPresence: qualityToEffects('high'),
    isRunner: true,
    sprintStamina: 1,
    boostActive: 0,
    boostIntensity: 0,
    aspectRatio: 16 / 9,
    ...overrides,
  };
}

/** Run enough frames for the exponential smoothing to settle on its target. */
function settle(input: PostFrameInput, frames = 600) {
  const smoothed = createPostSmoothedState();
  let params = computePostFrameParams(input, DEFAULT_POST_TUNING, smoothed);
  for (let i = 1; i < frames; i++) params = computePostFrameParams(input, DEFAULT_POST_TUNING, smoothed);
  return params;
}

describe('computePostFrameParams', () => {
  it('is neutral at rest in clear midday weather', () => {
    const p = settle(makeInput());
    expect(p.hueSaturation.saturation).toBeCloseTo(0, 5);
    expect(p.chromatic.amount).toBeCloseTo(DEFAULT_POST_TUNING.chromaticBaseOffset, 6);
    expect(p.vignette.darkness).toBeCloseTo(DEFAULT_POST_TUNING.vignetteDarkness, 5);
    expect(p.rainbow.intensity).toBeCloseTo(0, 5);
    expect(p.bloom.strength).toBeCloseTo(DEFAULT_POST_TUNING.bloomIntensity, 5);
  });

  it('desaturates and widens chromatic aberration with speed', () => {
    const p = settle(makeInput({ velocity: 30 }));
    expect(p.hueSaturation.saturation).toBeCloseTo(-0.5, 3);
    expect(p.chromatic.amount).toBeCloseTo(DEFAULT_POST_TUNING.chromaticMaxOffset, 5);
    // Over 0.9 × 25 m/s the "speed rush" vignette adds 0.3, plus the sprint 0.18.
    expect(p.vignette.darkness).toBeCloseTo(DEFAULT_POST_TUNING.vignetteDarkness + 0.3, 3);
  });

  it('tightens the vignette and dims bloom under a storm', () => {
    const clear = settle(makeInput());
    const storm = settle(makeInput({ weatherType: 'storm' }));
    expect(storm.vignette.darkness).toBeGreaterThan(clear.vignette.darkness);
    expect(storm.bloom.strength).toBeLessThan(clear.bloom.strength);
  });

  it('raises the rainbow only for a strong waterfall', () => {
    expect(settle(makeInput({ waterfallIntensity: 0.3 })).rainbow.intensity).toBeCloseTo(0, 5);
    expect(settle(makeInput({ waterfallIntensity: 1 })).rainbow.intensity).toBeCloseTo(1, 3);
  });

  it('drops the bloom threshold at night', () => {
    const day = settle(makeInput());
    const night = settle(makeInput({ sunWorldPosition: new THREE.Vector3(0, -40, -100) }));
    expect(night.bloom.threshold).toBeLessThan(day.bloom.threshold);
  });

  it('mirrors the quality preset toggles', () => {
    const low = settle(makeInput({ effectPresence: qualityToEffects('low') }));
    expect(low.ssao.enabled).toBe(false);
    expect(low.chromatic.enabled).toBe(false);
    expect(low.bloom.enabled).toBe(true);
    expect(low.vignette.enabled).toBe(true);
    const high = settle(makeInput());
    expect(high.ssao.enabled).toBe(true);
  });

  it('places the sun in top-left-origin screen space', () => {
    // Sun straight ahead and above the horizon: upper half of the screen.
    const p = settle(makeInput({ isTightCanyon: true, sunWorldPosition: new THREE.Vector3(0, 20, -100) }));
    expect(p.godRays.sunScreenPosition.x).toBeCloseTo(0.5, 3);
    expect(p.godRays.sunScreenPosition.y).toBeLessThan(0.5);
    expect(p.godRays.enabled).toBe(true);
  });

  it('keeps god rays off outside tight canyons and waterfalls', () => {
    const p = settle(makeInput({ sunWorldPosition: new THREE.Vector3(0, 20, -100) }));
    expect(p.godRays.allowed).toBe(true);
    expect(p.godRays.enabled).toBe(false);
  });
});

describe('godRaysAllowed', () => {
  it('follows preset, quality prop and LOD budget', () => {
    const high = qualityToEffects('high');
    expect(godRaysAllowed({ effectPresence: high, quality: 'high', enableGodRays: true })).toBe(true);
    expect(godRaysAllowed({ effectPresence: high, quality: 'high', enableGodRays: false })).toBe(false);
    // Medium runs a cheap 16-sample march even without the LOD flag.
    expect(godRaysAllowed({ effectPresence: high, quality: 'medium', enableGodRays: false })).toBe(true);
    expect(godRaysAllowed({ effectPresence: high, quality: 'low', enableGodRays: true })).toBe(false);
    expect(godRaysAllowed({ effectPresence: qualityToEffects('low'), quality: 'high', enableGodRays: true })).toBe(false);
  });
});
