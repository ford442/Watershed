import type { BiomeId } from '../biomes';

export interface BiomePalette {
  id: BiomeId;
  name: string;
  description: string;
  // Sky & Atmosphere
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  fogNear: number;
  fogFar: number;

  // Water
  waterColor: string;
  waterDeepColor: string;
  foamColor: string;
  causticsIntensity: number;
  waterOpacity: number;
  flowSpeed: number;

  // Lighting
  lightTemp: number; // Kelvin equivalent
  sunColor: string;
  sunIntensity: number;
  ambientIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  fillColor: string;
  fillIntensity: number;

  // Canyon/Rocks
  rockBaseColor: string;
  rockMossColor: string;
  weatheringIntensity: number;

  // Vegetation
  vegetationColor: string;
  vegetationDensity: number;
  treeDensity: number;
  grassDensity: number;
  wildflowerColors: string[];

  // Effects
  fireflyCount: number;
  mistDensity: number;
  sunShaftIntensity: number;
  fallingLeaves: boolean;

  // Audio cues (for future integration)
  ambientAudio?: string;

  // Transition timing
  transitionDuration: number; // seconds
}

export interface BiomeLightingOptions {
  /** Slot canyons get much less ambient/hemi fill — narrow, shadowed walls. */
  isSlotCanyon?: boolean;
  /** 'clear' | 'overcast' | 'fog' | 'storm' — dims/desaturates sun + boosts soft hemi fill. */
  weatherType?: string;
  /** 0 = sun at/below horizon, 1 = sun directly overhead. Drives color temperature + intensity. */
  sunElevation?: number;
}
