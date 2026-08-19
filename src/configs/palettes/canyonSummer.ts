import type { BiomePalette } from './types';

export const canyonSummer: BiomePalette = {
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
};
