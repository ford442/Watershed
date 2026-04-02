// src/constants/nightMode.ts
// Night mode configuration for Watershed

export interface NightModeConfig {
  /** Whether night mode is enabled by default */
  enabled: boolean;
  /** Day sky color (CSS hex) */
  skyColorDay: string;
  /** Night sky color (CSS hex) */
  skyColorNight: string;
  /** Day fog color (CSS hex) */
  fogColorDay: string;
  /** Night fog color (CSS hex) */
  fogColorNight: string;
  /** Toggle key */
  toggleKey: string;
  /** Bioluminescence intensity (0-1) */
  bioLuminescence: number;
}

export const NIGHT_MODE: NightModeConfig = {
  enabled: false,
  skyColorDay: '#87ceeb',
  skyColorNight: '#0a1428',
  fogColorDay: '#a5d6ff',
  fogColorNight: '#1a2a4a',
  toggleKey: 'n',
  bioLuminescence: 0.0,
};

/** Fog distances */
export const FOG = {
  day: { near: 20, far: 150 },
  night: { near: 10, far: 100 },
};

export default NIGHT_MODE;
