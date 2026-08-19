import type { BiomePalette } from './types';

export const glacialMelt: BiomePalette = {
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
};
