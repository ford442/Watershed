import type { BiomePalette } from './types';

export const canyonAutumn: BiomePalette = {
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
};
