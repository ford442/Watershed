import type { BiomePalette } from './types';

export const alpineSpring: BiomePalette = {
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
};
