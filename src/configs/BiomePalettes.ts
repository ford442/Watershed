/**
 * BiomePalettes - Complete visual profiles for environmental storytelling
 * 
 * Defines 6 distinct biomes with comprehensive color, lighting, and atmospheric
 * configurations for smooth transitions and immersive environment variation.
 */

import * as THREE from 'three';

export interface BiomePalette {
  id: string;
  name: string;
  description: string;
  // Sky & Atmosphere
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  fogNear: number;
  fogFar: number;
  
  // Water
  waterColor: string;
  waterDeepColor: string;
  foamColor: string;
  causticsIntensity: number;
  waterOpacity: number;
  flowSpeed: number;
  
  // Lighting
  lightTemp: number; // Kelvin equivalent
  sunColor: string;
  sunIntensity: number;
  ambientIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  fillColor: string;
  fillIntensity: number;
  
  // Canyon/Rocks
  rockBaseColor: string;
  rockMossColor: string;
  weatheringIntensity: number;
  
  // Vegetation
  vegetationColor: string;
  vegetationDensity: number;
  treeDensity: number;
  grassDensity: number;
  wildflowerColors: string[];
  
  // Effects
  fireflyCount: number;
  mistDensity: number;
  sunShaftIntensity: number;
  fallingLeaves: boolean;
  
  // Audio cues (for future integration)
  ambientAudio?: string;
  
  // Transition timing
  transitionDuration: number; // seconds
}

export const BiomePalettes: Record<string, BiomePalette> = {
  alpineSpring: {
    id: 'alpineSpring',
    name: 'Alpine Spring',
    description: 'Crisp snowmelt streams with evergreens and cold morning light',
    
    // Sky & Atmosphere
    skyColor: '#87CEEB',
    fogColor: '#E0F4FF',
    fogDensity: 0.015,
    fogNear: 60,
    fogFar: 280,
    
    // Water
    waterColor: '#2A8BA8',
    waterDeepColor: '#1a5a6a',
    foamColor: '#D0F0FF',
    causticsIntensity: 0.35,
    waterOpacity: 0.65,
    flowSpeed: 1.2,
    
    // Lighting - Cool morning light
    lightTemp: 6800,
    sunColor: '#E8F4FF',
    sunIntensity: 1.3,
    ambientIntensity: 0.35,
    hemiSkyColor: '#B0D4F0',
    hemiGroundColor: '#4a5a50',
    fillColor: '#A0C4E8',
    fillIntensity: 0.25,
    
    // Canyon
    rockBaseColor: '#808080',
    rockMossColor: '#4a5a50',
    weatheringIntensity: 0.6,
    
    // Vegetation - Fresh spring greens
    vegetationColor: '#4CAF50',
    vegetationDensity: 0.7,
    treeDensity: 0.8,
    grassDensity: 1.0,
    wildflowerColors: ['#f4d35e', '#c6e377', '#9ad1d4', '#f7f7ff'],
    
    // Effects
    fireflyCount: 0,
    mistDensity: 0.4,
    sunShaftIntensity: 0.6,
    fallingLeaves: false,
    
    transitionDuration: 5,
  },
  
  canyonSummer: {
    id: 'canyonSummer',
    name: 'Canyon Summer',
    description: 'Lush vegetation with warm golden light and abundant wildlife',
    
    // Sky & Atmosphere
    skyColor: '#4A90E2',
    fogColor: '#E8F4E8',
    fogDensity: 0.012,
    fogNear: 50,
    fogFar: 250,
    
    // Water
    waterColor: '#1A7B9C',
    waterDeepColor: '#0d4a5a',
    foamColor: '#D0E8FF',
    causticsIntensity: 0.55,
    waterOpacity: 0.7,
    flowSpeed: 1.0,
    
    // Lighting - Warm noon light
    lightTemp: 5500,
    sunColor: '#FFF8E8',
    sunIntensity: 1.45,
    ambientIntensity: 0.4,
    hemiSkyColor: '#9ad0f0',
    hemiGroundColor: '#3a3828',
    fillColor: '#A0C4E8',
    fillIntensity: 0.22,
    
    // Canyon
    rockBaseColor: '#A0826D',
    rockMossColor: '#587248',
    weatheringIntensity: 0.8,
    
    // Vegetation - Deep summer greens
    vegetationColor: '#228B22',
    vegetationDensity: 1.0,
    treeDensity: 1.0,
    grassDensity: 1.2,
    wildflowerColors: ['#ff6f91', '#ffd166', '#7bd389', '#8ec5ff', '#f7f3e9', '#ff8c42'],
    
    // Effects
    fireflyCount: 15,
    mistDensity: 0.3,
    sunShaftIntensity: 0.7,
    fallingLeaves: false,
    
    transitionDuration: 5,
  },
  
  canyonAutumn: {
    id: 'canyonAutumn',
    name: 'Canyon Autumn',
    description: 'Golden foliage with warm amber light and falling leaves',
    
    // Sky & Atmosphere
    skyColor: '#FF8C42',
    fogColor: '#FFD4A3',
    fogDensity: 0.018,
    fogNear: 40,
    fogFar: 200,
    
    // Water
    waterColor: '#5A4A3A',
    waterDeepColor: '#3d3020',
    foamColor: '#FFF8DC',
    causticsIntensity: 0.4,
    waterOpacity: 0.75,
    flowSpeed: 0.9,
    
    // Lighting - Warm amber evening light
    lightTemp: 3500,
    sunColor: '#FFB347',
    sunIntensity: 1.1,
    ambientIntensity: 0.32,
    hemiSkyColor: '#E8C070',
    hemiGroundColor: '#382818',
    fillColor: '#FFC888',
    fillIntensity: 0.18,
    
    // Canyon
    rockBaseColor: '#8B7355',
    rockMossColor: '#6A5838',
    weatheringIntensity: 0.9,
    
    // Vegetation - Autumn golds and rusts
    vegetationColor: '#D2691E',
    vegetationDensity: 0.8,
    treeDensity: 0.9,
    grassDensity: 0.6,
    wildflowerColors: ['#c96f3b', '#d89a54', '#b95c42', '#e0b36a', '#c7a27c'],
    
    // Effects
    fireflyCount: 8,
    mistDensity: 0.5,
    sunShaftIntensity: 0.8,
    fallingLeaves: true,
    
    transitionDuration: 5,
  },

  slotCanyon: {
    id: 'slotCanyon',
    name: 'Slot Canyon',
    description: 'Narrow, high-walled sandstone chutes with warm reflected light',

    // Sky & Atmosphere — bright strip of sky overhead, warm bounce
    skyColor: '#4A90E2',
    fogColor: '#F4E4D4',
    fogDensity: 0.02,
    fogNear: 30,
    fogFar: 180,

    // Water
    waterColor: '#8B5A3C',
    waterDeepColor: '#5A3A24',
    foamColor: '#EEDCC8',
    causticsIntensity: 0.35,
    waterOpacity: 0.75,
    flowSpeed: 1.1,

    // Lighting — warm, reflected canyon light
    lightTemp: 4500,
    sunColor: '#FFE4C4',
    sunIntensity: 1.0,
    ambientIntensity: 0.35,
    hemiSkyColor: '#D4A574',
    hemiGroundColor: '#5A3A28',
    fillColor: '#C48A5E',
    fillIntensity: 0.25,

    // Canyon — warm sandstone
    rockBaseColor: '#A65F3A',
    rockMossColor: '#4D2315',
    weatheringIntensity: 0.85,

    // Vegetation — sparse dry snags and drought plants
    vegetationColor: '#6B5B3D',
    vegetationDensity: 0.2,
    treeDensity: 0.15,
    grassDensity: 0.1,
    wildflowerColors: ['#c48a5e', '#b08050', '#9a7048'],

    // Effects
    fireflyCount: 0,
    mistDensity: 0.2,
    sunShaftIntensity: 0.9,
    fallingLeaves: false,

    transitionDuration: 5,
  },

  glacialMelt: {
    id: 'glacialMelt',
    name: 'Glacial Melt',
    description: 'Alpine source chute — ice-blue slush, narrow tube canyon, ultra-fast meltwater',

    // Sky & Atmosphere — pale high-altitude light, dense blue-white fog
    skyColor: '#C8E4F8',
    fogColor: '#E8F4FF',
    fogDensity: 0.022,
    fogNear: 35,
    fogFar: 200,

    // Water — milky ice-blue slush, brightest foam in the game
    waterColor: '#67C8E8',
    waterDeepColor: '#1A5A78',
    foamColor: '#F0FAFF',
    causticsIntensity: 0.35,
    waterOpacity: 0.78,
    flowSpeed: 1.85,

    // Lighting — low sun, cold and flat at altitude
    lightTemp: 8200,
    sunColor: '#E8F6FF',
    sunIntensity: 1.25,
    ambientIntensity: 0.34,
    hemiSkyColor: '#B0D4F0',
    hemiGroundColor: '#506878',
    fillColor: '#A0C8E8',
    fillIntensity: 0.18,

    // Canyon — white-grey ice-scoured rock, no moss
    rockBaseColor: '#C8D8E8',
    rockMossColor: '#4A6878',
    weatheringIntensity: 0.45,

    // Vegetation — nearly absent at the source
    vegetationColor: '#6A7A7A',
    vegetationDensity: 0.08,
    treeDensity: 0.05,
    grassDensity: 0.02,
    wildflowerColors: ['#a8c8d8', '#c0dce8', '#d8ecf8'],

    // Effects
    fireflyCount: 0,
    mistDensity: 0.45,
    sunShaftIntensity: 0.55,
    fallingLeaves: false,
    ambientAudio: 'ambient-glacial-wind',

    transitionDuration: 2,
  },

  glacier: {
    id: 'glacier',
    name: 'Glacier',
    description: 'High-altitude ice chutes with cold blue light and sparse dead timber',

    // Sky & Atmosphere — clear cold alpine sky
    skyColor: '#B8D4E8',
    fogColor: '#E0F0F8',
    fogDensity: 0.015,
    fogNear: 50,
    fogFar: 260,

    // Water — glacial melt, milky turquoise
    waterColor: '#5A9AA8',
    waterDeepColor: '#2A5A68',
    foamColor: '#D8F0FF',
    causticsIntensity: 0.4,
    waterOpacity: 0.7,
    flowSpeed: 1.4,

    // Lighting — cold, high-altitude daylight
    lightTemp: 7500,
    sunColor: '#F0F8FF',
    sunIntensity: 1.5,
    ambientIntensity: 0.38,
    hemiSkyColor: '#A8C8E0',
    hemiGroundColor: '#4A6070',
    fillColor: '#90B8D0',
    fillIntensity: 0.2,

    // Canyon — ice-scoured grey-blue granite
    rockBaseColor: '#B0C8D8',
    rockMossColor: '#3A5060',
    weatheringIntensity: 0.55,

    // Vegetation — almost none, dead greys
    vegetationColor: '#5A6A5A',
    vegetationDensity: 0.15,
    treeDensity: 0.1,
    grassDensity: 0.05,
    wildflowerColors: ['#9ab8c8', '#b0c8d8', '#c8dce8'],

    // Effects
    fireflyCount: 0,
    mistDensity: 0.3,
    sunShaftIntensity: 0.7,
    fallingLeaves: false,

    transitionDuration: 5,
  },

  cavern: {
    id: 'cavern',
    name: 'Mystic Cavern',
    description: 'Dark underground passages with bioluminescent elements',
    
    // Sky & Atmosphere - Dark indigo
    skyColor: '#1a1a2e',
    fogColor: '#0f0f1e',
    fogDensity: 0.035,
    fogNear: 15,
    fogFar: 120,
    
    // Water
    waterColor: '#0a1628',
    waterDeepColor: '#050a14',
    foamColor: '#1a2030',
    causticsIntensity: 0.15,
    waterOpacity: 0.85,
    flowSpeed: 0.6,
    
    // Lighting - Artificial cool blue-white
    lightTemp: 4500,
    sunColor: '#6A7BFF',
    sunIntensity: 0.4,
    ambientIntensity: 0.15,
    hemiSkyColor: '#1a1a2e',
    hemiGroundColor: '#0a0a14',
    fillColor: '#4A5A8A',
    fillIntensity: 0.3,
    
    // Canyon
    rockBaseColor: '#2a2a2a',
    rockMossColor: '#1a3020',
    weatheringIntensity: 0.5,
    
    // Vegetation - Dark mossy greens
    vegetationColor: '#1a4018',
    vegetationDensity: 0.3,
    treeDensity: 0.2,
    grassDensity: 0.3,
    wildflowerColors: ['#5d7a52', '#6f8b60', '#879a75'],
    
    // Effects
    fireflyCount: 25,
    mistDensity: 0.7,
    sunShaftIntensity: 0.2,
    fallingLeaves: false,
    
    transitionDuration: 5,
  },
  
  delta: {
    id: 'delta',
    name: 'River Delta',
    description: 'Wide marshy waters with calm flows and aquatic plants',
    
    // Sky & Atmosphere
    skyColor: '#87CEEB',
    fogColor: '#C8E6F0',
    fogDensity: 0.02,
    fogNear: 40,
    fogFar: 220,
    
    // Water
    waterColor: '#4A90A4',
    waterDeepColor: '#2a6070',
    foamColor: '#E6F7FF',
    causticsIntensity: 0.45,
    waterOpacity: 0.6,
    flowSpeed: 0.4,
    
    // Lighting - Bright midday
    lightTemp: 6000,
    sunColor: '#FFFFFF',
    sunIntensity: 1.35,
    ambientIntensity: 0.45,
    hemiSkyColor: '#B0E0E6',
    hemiGroundColor: '#4a5a4a',
    fillColor: '#90C0D0',
    fillIntensity: 0.2,
    
    // Canyon
    rockBaseColor: '#696969',
    rockMossColor: '#4a6a40',
    weatheringIntensity: 0.75,
    
    // Vegetation - Marsh greens
    vegetationColor: '#3d7c3d',
    vegetationDensity: 0.9,
    treeDensity: 0.6,
    grassDensity: 1.3,
    wildflowerColors: ['#f0c95d', '#d4e27a', '#80cfa9', '#d7eef8'],
    
    // Effects
    fireflyCount: 5,
    mistDensity: 0.6,
    sunShaftIntensity: 0.5,
    fallingLeaves: false,
    
    transitionDuration: 5,
  },
  
  midnightMist: {
    id: 'midnightMist',
    name: 'Midnight Mist',
    description: 'Dark mysterious atmosphere with heavy fog and glowing fireflies',
    
    // Sky & Atmosphere
    skyColor: '#0f1419',
    fogColor: '#1a2028',
    fogDensity: 0.04,
    fogNear: 10,
    fogFar: 100,
    
    // Water
    waterColor: '#0a1a25',
    waterDeepColor: '#050d14',
    foamColor: '#1a2a35',
    causticsIntensity: 0.2,
    waterOpacity: 0.8,
    flowSpeed: 0.7,
    
    // Lighting - Moonlit cool
    lightTemp: 6500,
    sunColor: '#6A8CA8',
    sunIntensity: 0.35,
    ambientIntensity: 0.12,
    hemiSkyColor: '#1a2030',
    hemiGroundColor: '#0a0f14',
    fillColor: '#2A3A50',
    fillIntensity: 0.15,
    
    // Canyon
    rockBaseColor: '#2a2a35',
    rockMossColor: '#1a2530',
    weatheringIntensity: 0.6,
    
    // Vegetation - Dark silhouettes
    vegetationColor: '#1a2a1a',
    vegetationDensity: 0.6,
    treeDensity: 0.5,
    grassDensity: 0.4,
    wildflowerColors: ['#5f6a5d', '#727d6f', '#8d917f'],
    
    // Effects
    fireflyCount: 30,
    mistDensity: 0.85,
    sunShaftIntensity: 0.15,
    fallingLeaves: false,
    
    transitionDuration: 5,
  },
};

/**
 * Maps legacy/track vocabulary and JSON-authored biome names to canonical
 * BiomePalette IDs. Any ID already in the canonical vocabulary passes through
 * unchanged (the `?? id` fallback in normalizeBiomeId).
 */
export const BIOME_ID_MAP: Record<string, string> = {
  // Track geometry vocabulary (src/configs/TrackBiomes.ts TrackBiomeId)
  summer: 'canyonSummer',
  autumn: 'canyonAutumn',
  glacialMelt: 'glacialMelt',
  glacier: 'glacialMelt',
  glacial: 'glacialMelt',
  // slotCanyon and glacier now have their own palettes/HUD labels.
  // JSON authored vocabulary (src/formats/LevelFormat.md BiomeType)
  'creek-summer': 'canyonSummer',
  'creek-autumn': 'canyonAutumn',
  'alpine-spring': 'alpineSpring',
  'alpine-glacial': 'glacialMelt',
  'glacial-melt': 'glacialMelt',
  'canyon-sunset': 'canyonAutumn',
  'midnight-mist': 'midnightMist',
};

/**
 * Normalise any biome identifier to a canonical BiomePalette key.
 * IDs already in the canonical vocabulary (e.g. 'canyonSummer') are returned
 * as-is so callers do not need to know which vocabulary is in use.
 */
export function normalizeBiomeId(id: string): string {
  return BIOME_ID_MAP[id] ?? id;
}

/**
 * Get biome palette by ID.
 * Accepts both the canonical BiomePalette vocabulary and legacy/track IDs —
 * normalizeBiomeId converts them to the canonical key before lookup.
 */
export function getBiomePalette(biomeId: string): BiomePalette {
  return BiomePalettes[normalizeBiomeId(biomeId)] || BiomePalettes.canyonSummer;
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

export interface BiomeLightingOptions {
  /** Slot canyons get much less ambient/hemi fill — narrow, shadowed walls. */
  isSlotCanyon?: boolean;
  /** 'clear' | 'overcast' | 'fog' | 'storm' — dims/desaturates sun + boosts soft hemi fill. */
  weatherType?: string;
  /** 0 = sun at/below horizon, 1 = sun directly overhead. Drives color temperature + intensity. */
  sunElevation?: number;
}

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
