import type { BiomePalette } from './types';

export const cavern: BiomePalette = {
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
};
