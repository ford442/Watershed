import type { BiomePalette } from './types';

export const slotCanyon: BiomePalette = {
  id: 'slotCanyon',
  name: 'Slot Canyon',
  description: 'Narrow, high-walled sandstone chutes with warm reflected light',

  // Sky & Atmosphere — bright strip of sky overhead, warm bounce
  skyColor: '#4A90E2',
  fogColor: '#F4E4D4',
  fogDensity: 0.02,
  fogNear: 30,
  fogFar: 180,

  // Water
  waterColor: '#8B5A3C',
  waterDeepColor: '#5A3A24',
  foamColor: '#EEDCC8',
  causticsIntensity: 0.35,
  waterOpacity: 0.75,
  flowSpeed: 1.1,

  // Lighting — warm, reflected canyon light
  lightTemp: 4500,
  sunColor: '#FFE4C4',
  sunIntensity: 1.0,
  ambientIntensity: 0.35,
  hemiSkyColor: '#D4A574',
  hemiGroundColor: '#5A3A28',
  fillColor: '#C48A5E',
  fillIntensity: 0.25,

  // Canyon — warm sandstone
  rockBaseColor: '#A65F3A',
  rockMossColor: '#4D2315',
  weatheringIntensity: 0.85,

  // Vegetation — sparse dry snags and drought plants
  vegetationColor: '#6B5B3D',
  vegetationDensity: 0.2,
  treeDensity: 0.15,
  grassDensity: 0.1,
  wildflowerColors: ['#c48a5e', '#b08050', '#9a7048'],

  // Effects
  fireflyCount: 0,
  mistDensity: 0.2,
  sunShaftIntensity: 0.9,
  fallingLeaves: false,

  transitionDuration: 5,
};
