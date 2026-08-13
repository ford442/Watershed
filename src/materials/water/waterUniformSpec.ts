/**
 * waterUniformSpec.ts — the single uniform contract shared by both water backends.
 *
 * `FlowingWater` drives the water surface by poking `material.uniforms.<name>.value`
 * every frame. That update loop must not care whether it is talking to a GLSL
 * ShaderMaterial or a TSL NodeMaterial, so both backends expose the SAME uniform
 * names, and both build them from this one spec.
 *
 * TSL `uniform()` / `texture()` nodes are `.value`-addressable exactly like
 * `THREE.IUniform`, which is what makes the shared update loop possible.
 *
 * `waterUniformSpec.test.ts` asserts the two backends' key sets stay identical —
 * add a uniform here and both backends get it or the guard fails.
 */

import * as THREE from 'three';
import { SWE_MEAN_DEPTH } from '../../systems/SWEHeightField';

/** Every uniform the water surface understands, in declaration order. */
export const WATER_UNIFORM_NAMES = [
  'time',
  'flowSpeed',
  'waterColor',
  'deepColor',
  'foamColor',
  'edgeHighlight',
  'bioLuminescence',
  'timeOfDay',
  'weatherRipple',
  'wetness',
  'slushiness',
  'vehiclePos',
  'vehicleVelocity',
  'flowMap',
  'cameraHeight',
  'sunDir',
  'godRayStrength',
  'sunWorldPos',
  'isPond',
  'sweHeightMap',
  'sweOrigin',
  'sweCellSize',
  'sweGridSize',
  'sweMeanDepth',
  'sweDisplacementScale',
  'sweEnabled',
  'reflectionTexture',
  'reflectionStrength',
  'vortexCenter',
  'vortexRadius',
  'vortexIntensity',
] as const;

export type WaterUniformName = (typeof WATER_UNIFORM_NAMES)[number];

/** Uniform names that carry a texture (backends bind these differently). */
export const WATER_TEXTURE_UNIFORM_NAMES: readonly WaterUniformName[] = [
  'flowMap',
  'sweHeightMap',
  'reflectionTexture',
];

export interface WaterUniformInit {
  flowSpeed: number;
  waterColor: THREE.Color | string | number;
  deepColor: THREE.Color | string | number;
  foamColor: THREE.Color | string | number;
  edgeHighlight: THREE.Color | string | number;
  weatherRipple?: number;
  wetness?: number;
  slushiness?: number;
  isPond?: boolean;
  vehiclePos?: THREE.Vector3 | null;
  vehicleVelocity?: THREE.Vector3 | null;
  flowMap?: THREE.Texture | null;
  sunWorldPosition?: THREE.Vector3 | null;
  reflectionFallback?: THREE.Texture | null;
  vortexCenter?: THREE.Vector3 | null;
  vortexRadius?: number;
  vortexIntensity?: number;
  sweDisplacementScale?: number;
}

/** Sentinel "infinitely far away" position — disables vehicle/vortex terms. */
export const WATER_FAR_AWAY = Object.freeze({ x: 99999, y: 99999, z: 99999 });

/**
 * Plain values for every uniform, before either backend wraps them.
 * Colors are cloned so a material can never mutate a caller's Color.
 */
export function createWaterUniformValues(init: WaterUniformInit): Record<WaterUniformName, unknown> {
  return {
    time: 0,
    flowSpeed: init.flowSpeed,
    waterColor: new THREE.Color(init.waterColor as THREE.ColorRepresentation),
    deepColor: new THREE.Color(init.deepColor as THREE.ColorRepresentation),
    foamColor: new THREE.Color(init.foamColor as THREE.ColorRepresentation),
    edgeHighlight: new THREE.Color(init.edgeHighlight as THREE.ColorRepresentation),
    bioLuminescence: 0,
    timeOfDay: 0,
    weatherRipple: init.weatherRipple ?? 0,
    wetness: init.wetness ?? 0,
    slushiness: init.slushiness ?? 0,
    vehiclePos: init.vehiclePos
      ? new THREE.Vector3().copy(init.vehiclePos)
      : new THREE.Vector3(WATER_FAR_AWAY.x, WATER_FAR_AWAY.y, WATER_FAR_AWAY.z),
    vehicleVelocity: init.vehicleVelocity
      ? new THREE.Vector3().copy(init.vehicleVelocity)
      : new THREE.Vector3(),
    flowMap: init.flowMap ?? null,
    cameraHeight: 0,
    sunDir: new THREE.Vector3(0.3, 1.0, -0.4).normalize(),
    godRayStrength: 0,
    sunWorldPos: init.sunWorldPosition
      ? new THREE.Vector3().copy(init.sunWorldPosition)
      : new THREE.Vector3(100, 200, -100),
    isPond: init.isPond ? 1 : 0,
    sweHeightMap: null,
    sweOrigin: new THREE.Vector2(),
    sweCellSize: 0.5,
    sweGridSize: new THREE.Vector2(48, 32),
    sweMeanDepth: SWE_MEAN_DEPTH,
    sweDisplacementScale: init.sweDisplacementScale ?? 0.22,
    sweEnabled: 0,
    reflectionTexture: init.reflectionFallback ?? null,
    reflectionStrength: 0,
    vortexCenter: init.vortexCenter
      ? new THREE.Vector3().copy(init.vortexCenter)
      : new THREE.Vector3(WATER_FAR_AWAY.x, 0, WATER_FAR_AWAY.z),
    vortexRadius: init.vortexRadius || 10,
    vortexIntensity: init.vortexIntensity ?? 0,
  };
}

/** Wrap the spec values as classic `THREE.IUniform` records for a ShaderMaterial. */
export function createGlslWaterUniforms(
  init: WaterUniformInit,
): Record<WaterUniformName, THREE.IUniform> {
  const values = createWaterUniformValues(init);
  const uniforms = {} as Record<WaterUniformName, THREE.IUniform>;
  for (const name of WATER_UNIFORM_NAMES) {
    uniforms[name] = { value: values[name] };
  }
  return uniforms;
}
