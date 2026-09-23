/**
 * postFrameParams — per-frame post-processing targets, backend-agnostic.
 *
 * Both post drivers read this: the JSM `EffectComposer` on the GLSL path and
 * the node `RenderPipeline` on the TSL path (epic #434 B2). Keeping the speed /
 * biome / weather / waterfall mood math in one pure function is what makes
 * "`?material=tsl` renders the same post set as GLSL" checkable in a unit test
 * instead of by eye.
 */
import * as THREE from 'three';
import type { EffectPresence } from '../../systems/settings/settingsDerive';
import { getGodRaySunColor } from '../../systems/volumetric/VolumetricGodRays';

export type PostQualityLevel = 'low' | 'medium' | 'high' | 'ultra';

/** Tunables that arrive as `PostProcessingPipeline` props. */
export interface PostTuning {
  bloomIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  vignetteOffset: number;
  vignetteDarkness: number;
  chromaticBaseOffset: number;
  chromaticMaxOffset: number;
}

export const DEFAULT_POST_TUNING: PostTuning = {
  bloomIntensity: 0.5,
  bloomThreshold: 0.8,
  bloomRadius: 0.5,
  vignetteOffset: 0.35,
  vignetteDarkness: 0.5,
  chromaticBaseOffset: 0.001,
  chromaticMaxOffset: 0.002,
};

/** Exponentially smoothed values carried between frames. */
export interface PostSmoothedState {
  chromaticOffset: number;
  saturation: number;
  vignetteBoost: number;
  rainbowIntensity: number;
}

export function createPostSmoothedState(tuning: PostTuning = DEFAULT_POST_TUNING): PostSmoothedState {
  return {
    chromaticOffset: tuning.chromaticBaseOffset,
    saturation: 1.0,
    vignetteBoost: 0,
    rainbowIntensity: 0,
  };
}

export interface GodRaysGateInput {
  effectPresence: EffectPresence;
  quality: PostQualityLevel;
  enableGodRays: boolean;
}

/**
 * Whether god rays may run at all for this quality / LOD combination. On the
 * node path this decides whether the ray-march node is in the graph; per-frame
 * visibility (tight canyon, waterfall, sun on screen) is `godRays.enabled`.
 */
export function godRaysAllowed({ effectPresence, quality, enableGodRays }: GodRaysGateInput): boolean {
  return (
    effectPresence.godRays &&
    (quality === 'medium' || quality === 'high' || quality === 'ultra') &&
    (enableGodRays || quality === 'medium')
  );
}

export interface PostFrameInput {
  delta: number;
  elapsed: number;
  /** Horizontal vehicle speed (m/s); non-finite velocities are the caller's to reject. */
  velocity: number;
  waterfallIntensity: number;
  isTightCanyon: boolean;
  biomeId: string | undefined;
  weatherType: string;
  timeOfDay: number;
  sunWorldPosition: THREE.Vector3;
  camera: THREE.Camera;
  quality: PostQualityLevel;
  enableGodRays: boolean;
  volumetricSamples: number;
  effectPresence: EffectPresence;
  isRunner: boolean;
  sprintStamina: number;
  /** Remaining boost seconds (already decayed by the caller) and its intensity. */
  boostActive: number;
  boostIntensity: number;
  aspectRatio: number;
}

export interface PostFrameParams {
  bloom: { enabled: boolean; strength: number; threshold: number; radius: number };
  ssao: { enabled: boolean };
  hueSaturation: { saturation: number };
  chromatic: { enabled: boolean; amount: number };
  vignette: { enabled: boolean; offset: number; darkness: number };
  godRays: {
    allowed: boolean;
    enabled: boolean;
    sunScreenPosition: THREE.Vector2;
    sunColor: THREE.Color;
    intensity: number;
    samples: number;
    decay: number;
    exposure: number;
    rayLength: number;
    density: number;
    wallOcclusion: number;
    time: number;
  };
  rainbow: { intensity: number; time: number; aspectRatio: number };
}

const _sunClip = new THREE.Vector3();
const _cameraForward = new THREE.Vector3();
const _sunDir = new THREE.Vector3();

/**
 * Advance `smoothed` by one frame and return every pass's parameters.
 * Pure apart from mutating `smoothed` (and the returned objects' scratch).
 */
export function computePostFrameParams(
  input: PostFrameInput,
  tuning: PostTuning,
  smoothed: PostSmoothedState,
): PostFrameParams {
  const { delta, velocity, effectPresence, quality } = input;
  const boostScale = input.boostActive > 0 ? input.boostIntensity : 0;
  const speedFactor = Math.min(1, velocity / 25);
  const waterfallBoost = THREE.MathUtils.clamp(input.waterfallIntensity, 0, 1);

  // Biome/weather mood — slot canyons get a more artistic, claustrophobic
  // vignette; overcast/storm desaturate and soften the whole frame.
  const isSlotCanyon = input.biomeId === 'slotCanyon';
  const isDelta = input.biomeId === 'delta';
  const overcastBlend = input.weatherType === 'storm' ? 1
    : input.weatherType === 'overcast' ? 0.6
    : input.weatherType === 'fog' ? 0.35
    : 0;
  const sunElevation = THREE.MathUtils.clamp(input.sunWorldPosition.y / 40, 0, 1);
  const nightFactor = 1 - sunElevation;

  const targetChromatic =
    tuning.chromaticBaseOffset +
    (tuning.chromaticMaxOffset - tuning.chromaticBaseOffset) * speedFactor +
    boostScale * 0.0025 +
    waterfallBoost * 0.0009;

  // Saturation target — delta keeps warmer saturation at low speed.
  let targetSaturation = isDelta ? 1.08 : 1.0;
  if (velocity > 5) {
    if (velocity <= 15) {
      targetSaturation = 1.0 - ((velocity - 5) / 10) * 0.3;
    } else if (velocity <= 25) {
      targetSaturation = 0.7 - ((velocity - 15) / 10) * 0.2;
    } else {
      targetSaturation = 0.5;
    }
    if (isDelta) targetSaturation = Math.min(1.1, targetSaturation + 0.12);
  }
  targetSaturation = Math.min(1, targetSaturation + boostScale * 0.15);
  targetSaturation *= 1 - overcastBlend * 0.4;

  // "Speed rush": vignette tightens modestly while sprinting at speed on foot.
  const isSprintingAtSpeed = input.isRunner && velocity > 12 && input.sprintStamina < 0.999;
  const sprintVignetteBoost = isSprintingAtSpeed ? 0.18 : 0;
  const biomeVignetteBoost = (isSlotCanyon ? 0.12 : 0) + (isDelta ? 0.06 : 0) + overcastBlend * 0.08;
  const targetVignetteBoost =
    (velocity > 25 * 0.9 ? 0.3 : 0) + waterfallBoost * 0.08 + sprintVignetteBoost + biomeVignetteBoost;

  const t = 1 - Math.exp(-delta * 10);
  smoothed.chromaticOffset += (targetChromatic - smoothed.chromaticOffset) * t;
  smoothed.saturation += (targetSaturation - smoothed.saturation) * t;
  smoothed.vignetteBoost += (targetVignetteBoost - smoothed.vignetteBoost) * t;

  const targetRainbow = Math.max(0, (waterfallBoost - 0.35) / 0.65);
  smoothed.rainbowIntensity += (targetRainbow - smoothed.rainbowIntensity) * (1 - Math.exp(-delta * 3));

  // God rays
  const allowed = godRaysAllowed(input);
  const { camera, sunWorldPosition } = input;
  _sunClip.copy(sunWorldPosition).project(camera);
  const sunVisible = _sunClip.z > -1.0 && _sunClip.z < 1.0;
  camera.getWorldDirection(_cameraForward);
  _sunDir.copy(sunWorldPosition).sub(camera.position).normalize();
  const alignment = Math.max(0, _cameraForward.dot(_sunDir));
  const godRaysEnabled = allowed && (input.isTightCanyon || waterfallBoost > 0.2) && sunVisible;

  return {
    bloom: {
      enabled: effectPresence.bloom,
      // At night, drop the threshold so fireflies, moonlit water glints and wet
      // specular highlights glow; trim strength under heavy overcast/storm.
      strength: (tuning.bloomIntensity + boostScale * 0.4 + waterfallBoost * 0.55) * (1 - overcastBlend * 0.3),
      threshold: Math.max(
        0.15,
        tuning.bloomThreshold - boostScale * 0.15 - waterfallBoost * 0.1 - nightFactor * 0.25,
      ),
      radius: tuning.bloomRadius + boostScale * 0.2 + waterfallBoost * 0.12 + nightFactor * 0.08,
    },
    ssao: { enabled: effectPresence.ssao },
    // HueSaturationShader convention: 0 = unchanged, negative = desaturate.
    hueSaturation: { saturation: smoothed.saturation - 1.0 },
    chromatic: { enabled: effectPresence.chromaticAberration, amount: smoothed.chromaticOffset },
    vignette: {
      enabled: effectPresence.vignette,
      offset: tuning.vignetteOffset,
      darkness: tuning.vignetteDarkness + smoothed.vignetteBoost,
    },
    godRays: {
      allowed,
      enabled: godRaysEnabled,
      sunScreenPosition: new THREE.Vector2((_sunClip.x + 1) * 0.5, (1 - _sunClip.y) * 0.5),
      sunColor: getGodRaySunColor(input.timeOfDay),
      intensity:
        (quality === 'medium' ? 0.45 : 0.6) * Math.max(0.35, alignment) * (1 + waterfallBoost * 0.55),
      samples: quality === 'medium' ? 16 : Math.max(48, input.volumetricSamples || 48),
      decay: 0.95,
      exposure: quality === 'medium' ? 0.14 : 0.18,
      rayLength: 0.4,
      density: 0.96,
      wallOcclusion: 0.92,
      time: input.elapsed,
    },
    rainbow: {
      intensity: smoothed.rainbowIntensity,
      time: input.elapsed,
      aspectRatio: input.aspectRatio,
    },
  };
}
