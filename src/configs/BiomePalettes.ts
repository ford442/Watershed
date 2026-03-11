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
    
    // Effects
    fireflyCount: 8,
    mistDensity: 0.5,
    sunShaftIntensity: 0.8,
    fallingLeaves: true,
    
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
    
    // Effects
    fireflyCount: 30,
    mistDensity: 0.85,
    sunShaftIntensity: 0.15,
    fallingLeaves: false,
    
    transitionDuration: 5,
  },
};

/**
 * Get biome palette by ID
 */
export function getBiomePalette(biomeId: string): BiomePalette {
  return BiomePalettes[biomeId] || BiomePalettes.canyonSummer;
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
export function applyBiomeToLighting(palette: BiomePalette, lights: {
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
}) {
  lights.ambient.intensity = palette.ambientIntensity;
  
  lights.hemi.color.set(palette.hemiSkyColor);
  lights.hemi.groundColor.set(palette.hemiGroundColor);
  lights.hemi.intensity = 0.85;
  
  lights.sun.color.set(palette.sunColor);
  lights.sun.intensity = palette.sunIntensity;
  
  lights.fill.color.set(palette.fillColor);
  lights.fill.intensity = palette.fillIntensity;
}

export default BiomePalettes;
