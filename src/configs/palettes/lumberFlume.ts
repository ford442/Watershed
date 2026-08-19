import type { BiomePalette } from './types';

export const lumberFlume: BiomePalette = {
  id: 'lumberFlume',
  name: 'Lumber Flume',
  description: 'Mossy wooden aqueduct through dense forest — dappled sun shafts, damp timber greens',

  // Filtered canopy sky, soft green haze
  skyColor: '#6BA88A',
  fogColor: '#A8C8B0',
  fogDensity: 0.024,
  fogNear: 28,
  fogFar: 160,

  // Tea-stained flume water
  waterColor: '#3A7A58',
  waterDeepColor: '#1a4030',
  foamColor: '#D8F0E0',
  causticsIntensity: 0.45,
  waterOpacity: 0.82,
  flowSpeed: 1.55,

  // Warm dappled noon through canopy gaps
  lightTemp: 5200,
  sunColor: '#FFE8C0',
  sunIntensity: 1.05,
  ambientIntensity: 0.38,
  hemiSkyColor: '#90C0A0',
  hemiGroundColor: '#2a4030',
  fillColor: '#B0D080',
  fillIntensity: 0.28,

  // Wet bark / mossy timber canyon walls
  rockBaseColor: '#5a4a38',
  rockMossColor: '#2a5a2a',
  weatheringIntensity: 0.85,

  // Dense forest floor
  vegetationColor: '#2d6a2d',
  vegetationDensity: 1.35,
  treeDensity: 1.45,
  grassDensity: 1.0,
  wildflowerColors: ['#c8e070', '#e0a060', '#70b070', '#f0d898'],

  fireflyCount: 10,
  mistDensity: 0.42,
  sunShaftIntensity: 0.95,
  fallingLeaves: false,
  ambientAudio: 'ambient-flume-001',

  transitionDuration: 4,
};
