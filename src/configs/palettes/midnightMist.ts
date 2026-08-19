import type { BiomePalette } from './types';

export const midnightMist: BiomePalette = {
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
};
