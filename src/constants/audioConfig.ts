/**
 * Audio Configuration
 *
 * Tunable parameters for the reactive audio system.
 */

export const AUDIO_CONFIG = {
  /** Master volume scaler for all reactive audio layers */
  masterVolume: 0.85,

  ambient: {
    /** Base volume of the calm ambient layer */
    lowVolume: 0.35,
    /** Base volume of the medium ambient layer */
    midVolume: 0.4,
    /** Base volume of the intense ambient layer */
    highVolume: 0.45,
    /** Speed of crossfading between ambient intensity levels */
    crossfadeSpeed: 2.5,
  },

  sfx: {
    /** Minimum rapids/roar loop volume */
    rapidsBaseVolume: 0.2,
    /** Maximum rapids/roar loop volume */
    rapidsMaxVolume: 0.95,
    /** Player speed required to trigger splash one-shots */
    splashThresholdSpeed: 6.0,
    /** Turbulence level required to trigger splash one-shots */
    splashThresholdTurbulence: 0.35,
    /** Cooldown between splash sounds (seconds) */
    splashCooldown: 0.55,
    /** Splash sound volume multiplier */
    splashVolume: 0.65,
  },

  positional: {
    /** Reference distance for transition (waterfall) positional audio */
    transitionRefDistance: 18,
    /** Rolloff factor for transition audio */
    transitionRolloff: 0.9,
    /** Max volume of transition positional audio when close */
    transitionMaxVolume: 0.85,
    /** Distance at which transition audio fully fades out */
    transitionFadeDistance: 45,
  },

  intensity: {
    /** How much flowSpeed contributes to total intensity (0-1 range typical) */
    flowSpeedWeight: 0.45,
    /** How much player speed contributes to intensity */
    playerSpeedWeight: 0.018,
    /** Hard cap on computed intensity */
    maxIntensity: 1.0,
  },

  /** Fallback sound names from AudioSystem SOUND_LIBRARY */
  defaultAmbientTracks: {
    low: 'ambient_water',
    mid: 'ambient_wind',
    high: 'ambient_canyon',
  },

  defaultSfxTracks: {
    rapids: 'rapids_roar',
    transition: 'rapids_roar',
    splash: 'collide_water',
  },
} as const;

export type AudioConfig = typeof AUDIO_CONFIG;
