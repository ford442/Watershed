import type { BiomePalette } from './types';

export const glacier: BiomePalette = {
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
};
