import type { BiomePalette } from './types';

export const delta: BiomePalette = {
  id: 'delta',
  name: 'River Delta',
  description: 'Wide marshy waters at golden hour — calm flows, sandbars, beach landing',

  // Sky & Atmosphere — warm launch-hour / sunset
  skyColor: '#E8A060',
  fogColor: '#D4B896',
  fogDensity: 0.018,
  fogNear: 45,
  fogFar: 240,

  // Water — slower marsh tones
  waterColor: '#5A8F8A',
  waterDeepColor: '#2A5A58',
  foamColor: '#F0E8D8',
  causticsIntensity: 0.35,
  waterOpacity: 0.62,
  flowSpeed: 0.28,

  // Lighting — low sun / golden hour
  lightTemp: 3200,
  sunColor: '#FFB060',
  sunIntensity: 0.95,
  ambientIntensity: 0.42,
  hemiSkyColor: '#F0C080',
  hemiGroundColor: '#5A6A48',
  fillColor: '#C08050',
  fillIntensity: 0.28,

  // Canyon — low sandy banks
  rockBaseColor: '#9A9A78',
  rockMossColor: '#5A7A50',
  weatheringIntensity: 0.85,

  // Vegetation — marsh greens
  vegetationColor: '#3d7c3d',
  vegetationDensity: 0.9,
  treeDensity: 0.35,
  grassDensity: 1.35,
  wildflowerColors: ['#f0c95d', '#d4e27a', '#80cfa9', '#d7eef8'],

  // Effects — soft sunset shafts, long mist
  fireflyCount: 8,
  mistDensity: 0.55,
  sunShaftIntensity: 0.75,
  fallingLeaves: false,

  transitionDuration: 5,
};
