/**
 * BiomePalettes - Complete visual profiles for environmental storytelling
 *
 * Defines distinct biomes with comprehensive color, lighting, and atmospheric
 * configurations for smooth transitions and immersive environment variation.
 *
 * Canonical IDs live in `../biomes.ts` (BiomeId). Legacy aliases are resolved
 * only at map-load via normalizeBiomeId — getBiomePalette expects BiomeId.
 */

import * as THREE from 'three';
import {
  type BiomeId,
  DEFAULT_BIOME_ID,
  isBiomeId,
  normalizeBiomeId,
} from '../biomes';

import type { BiomeLightingOptions, BiomePalette } from './types';
import { alpineSpring } from './alpineSpring';
import { canyonSummer } from './canyonSummer';
import { canyonAutumn } from './canyonAutumn';
import { slotCanyon } from './slotCanyon';
import { glacialMelt } from './glacialMelt';
import { glacier } from './glacier';
import { cavern } from './cavern';
import { delta } from './delta';
import { midnightMist } from './midnightMist';
import { lumberFlume } from './lumberFlume';
import { hydroDam } from './hydroDam';

export type { BiomeId } from '../biomes';
export {
  BIOME_IDS,
  DEFAULT_BIOME_ID,
  LEGACY_BIOME_ALIASES,
  isAutumnLike,
  isBiomeId,
  isSummerLike,
  normalizeBiomeId,
} from '../biomes';

export type { BiomePalette, BiomeLightingOptions } from './types';

export const BiomePalettes: Record<BiomeId, BiomePalette> = {
  alpineSpring,
  canyonSummer,
  canyonAutumn,
  slotCanyon,
  glacialMelt,
  glacier,
  cavern,
  delta,
  midnightMist,
  lumberFlume,
  hydroDam,
};

/**
 * Get biome palette by canonical BiomeId.
 * For raw authored strings, call normalizeBiomeId at the map-load boundary first.
 * (Still accepts legacy strings for one release via normalizeBiomeId.)
 */
export function getBiomePalette(biomeId: BiomeId | string): BiomePalette {
  const id = isBiomeId(biomeId) ? biomeId : normalizeBiomeId(biomeId);
  return BiomePalettes[id] ?? BiomePalettes[DEFAULT_BIOME_ID];
}

/**
 * Interpolate between two biome palettes
 */
export function lerpBiomePalettes(
  from: BiomePalette,
  to: BiomePalette,
  alpha: number
): BiomePalette {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const lerpColor = (a: string, b: string, t: number) => {
    const c1 = new THREE.Color(a);
    const c2 = new THREE.Color(b);
    c1.lerp(c2, t);
    return '#' + c1.getHexString();
  };

  // Ease in-out for smoother transitions
  const easedAlpha = alpha < 0.5
    ? 4 * alpha * alpha * alpha
    : 1 - Math.pow(-2 * alpha + 2, 3) / 2;

  return {
    ...to,
    skyColor: lerpColor(from.skyColor, to.skyColor, easedAlpha),
    fogColor: lerpColor(from.fogColor, to.fogColor, easedAlpha),
    waterColor: lerpColor(from.waterColor, to.waterColor, easedAlpha),
    foamColor: lerpColor(from.foamColor, to.foamColor, easedAlpha),
    sunColor: lerpColor(from.sunColor, to.sunColor, easedAlpha),
    hemiSkyColor: lerpColor(from.hemiSkyColor, to.hemiSkyColor, easedAlpha),
    hemiGroundColor: lerpColor(from.hemiGroundColor, to.hemiGroundColor, easedAlpha),
    fillColor: lerpColor(from.fillColor, to.fillColor, easedAlpha),
    vegetationColor: lerpColor(from.vegetationColor, to.vegetationColor, easedAlpha),
    rockBaseColor: lerpColor(from.rockBaseColor, to.rockBaseColor, easedAlpha),
    rockMossColor: lerpColor(from.rockMossColor, to.rockMossColor, easedAlpha),

    fogDensity: lerp(from.fogDensity, to.fogDensity, easedAlpha),
    causticsIntensity: lerp(from.causticsIntensity, to.causticsIntensity, easedAlpha),
    lightTemp: lerp(from.lightTemp, to.lightTemp, easedAlpha),
    sunIntensity: lerp(from.sunIntensity, to.sunIntensity, easedAlpha),
    ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity, easedAlpha),
    weatheringIntensity: lerp(from.weatheringIntensity, to.weatheringIntensity, easedAlpha),
    vegetationDensity: lerp(from.vegetationDensity, to.vegetationDensity, easedAlpha),
    treeDensity: lerp(from.treeDensity, to.treeDensity, easedAlpha),
    grassDensity: lerp(from.grassDensity, to.grassDensity, easedAlpha),
    mistDensity: lerp(from.mistDensity, to.mistDensity, easedAlpha),
    sunShaftIntensity: lerp(from.sunShaftIntensity, to.sunShaftIntensity, easedAlpha),

    fireflyCount: Math.round(lerp(from.fireflyCount, to.fireflyCount, easedAlpha)),
    flowSpeed: lerp(from.flowSpeed, to.flowSpeed, easedAlpha),
    waterOpacity: lerp(from.waterOpacity, to.waterOpacity, easedAlpha),
  };
}

/**
 * Apply biome palette to scene lighting
 */
// Scratch colors reused every frame to avoid per-call allocation.
const _hemiSkyScratch = new THREE.Color();
const _sunScratch = new THREE.Color();
const _greyScratch = new THREE.Color();
const _fillScratch = new THREE.Color();
const HORIZON_TINT = new THREE.Color('#ff7e3d');
const OVERCAST_HEMI_TINT = new THREE.Color('#9aa4ad');
const NIGHT_HEMI_TINT = new THREE.Color('#5a6a8a');
const OVERCAST_SUN_GREY = new THREE.Color('#aab2bb');

/**
 * Applies a biome palette to the scene's core lights, with creative
 * time-of-day and weather modulation layered on top:
 *  - Sun warms toward orange near the horizon and dims at low elevation.
 *  - Overcast/storm desaturates and dims the sun while boosting soft hemi fill.
 *  - Slot canyons get a cooler, much dimmer ambient/hemi for a moody read.
 */
export function applyBiomeToLighting(palette: BiomePalette, lights: {
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
}, options: BiomeLightingOptions = {}) {
  const { isSlotCanyon = false, weatherType = 'clear', sunElevation = 1 } = options;

  const overcastBlend = weatherType === 'storm' ? 1
    : weatherType === 'overcast' ? 0.6
    : weatherType === 'fog' ? 0.35
    : 0;
  // 0 = high sun, 1 = sun at/below horizon
  const horizonBlend = THREE.MathUtils.clamp(1 - sunElevation, 0, 1);

  // Ambient: slot canyons read much darker/moodier; overcast bumps soft skylight.
  let ambientIntensity = palette.ambientIntensity;
  if (isSlotCanyon) ambientIntensity = Math.min(ambientIntensity, 0.18);
  ambientIntensity *= 1 + overcastBlend * 0.25;
  lights.ambient.intensity = ambientIntensity;

  // Hemisphere: cool toward dusk/night, flatten toward grey under heavy weather.
  _hemiSkyScratch.set(isSlotCanyon ? '#1a120a' : palette.hemiSkyColor);
  _hemiSkyScratch.lerp(NIGHT_HEMI_TINT, horizonBlend * 0.4);
  _hemiSkyScratch.lerp(OVERCAST_HEMI_TINT, overcastBlend * 0.7);
  lights.hemi.color.copy(_hemiSkyScratch);
  lights.hemi.groundColor.set(isSlotCanyon ? '#0a0806' : palette.hemiGroundColor);
  let hemiIntensity = isSlotCanyon ? 0.25 : 0.85;
  hemiIntensity *= 1 - overcastBlend * 0.2;
  lights.hemi.intensity = hemiIntensity;

  // Sun: warm color-temperature shift near the horizon, desaturate + dim under weather.
  _sunScratch.set(palette.sunColor);
  _sunScratch.lerp(HORIZON_TINT, horizonBlend * 0.55);
  if (overcastBlend > 0) {
    _greyScratch.copy(_sunScratch).lerp(OVERCAST_SUN_GREY, 0.85);
    _sunScratch.lerp(_greyScratch, overcastBlend);
  }
  lights.sun.color.copy(_sunScratch);
  // Floor is low (not flat 0.35) so a true night sky reads as genuinely dark —
  // moonlight (EnhancedSky's moonLightRef, ~0.18 cool blue) becomes the
  // dominant light source rather than competing with a still-bright "sun".
  let sunIntensity = palette.sunIntensity * (0.06 + 0.94 * sunElevation);
  sunIntensity *= 1 - overcastBlend * 0.55;
  lights.sun.intensity = Math.max(0.02, sunIntensity);

  // Fill/rim light — biome-tinted (warm canyon rim in summer, cool blue in slot
  // canyon), cooling toward moonlight blue as the sun drops toward the horizon.
  _fillScratch.set(palette.fillColor);
  _fillScratch.lerp(NIGHT_HEMI_TINT, horizonBlend * 0.5);
  lights.fill.color.copy(_fillScratch);
  lights.fill.intensity = palette.fillIntensity * (1 - overcastBlend * 0.3) * (0.5 + 0.5 * sunElevation);
}

export default BiomePalettes;
