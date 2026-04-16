/**
 * Weather System Configuration
 *
 * Tunable parameters for dynamic weather effects.
 */

export type WeatherType = 'clear' | 'rain' | 'fog' | 'storm';

export const WEATHER_CONFIG = {
  /** Default weather when no manifest value is provided */
  defaultWeather: 'clear' as WeatherType,

  /** Global weather transition speed (lerp factor per second) */
  transitionSpeed: 1.5,

  rain: {
    /** Total rain drop particles */
    particleCount: 12000,
    /** Base fall speed of raindrops */
    fallSpeed: 35,
    /** How much wind pushes rain horizontally */
    windX: 2.5,
    /** How much wind pushes rain along Z */
    windZ: 1.0,
    /** Area width around player where rain spawns */
    spawnWidth: 40,
    /** Area length around player where rain spawns */
    spawnLength: 50,
    /** Area height above player where rain spawns */
    spawnHeight: 30,
    /** Splash particle count on water surface */
    splashCount: 600,
    /** How bright splash particles are */
    splashBrightness: 0.7,
  },

  fog: {
    /** Fog density in clear weather */
    clearDensity: 0.008,
    /** Fog density in rain */
    rainDensity: 0.022,
    /** Fog density in fog weather */
    fogDensity: 0.045,
    /** Fog density in storm */
    stormDensity: 0.065,
    /** Fog color in clear weather (hex) */
    clearColor: '#a5d6ff',
    /** Fog color in rain (hex) */
    rainColor: '#6a7a8a',
    /** Fog color in fog (hex) */
    fogColor: '#4a5a6a',
    /** Fog color in storm (hex) */
    stormColor: '#3a4a5a',
  },

  lighting: {
    /** Directional light intensity multiplier in clear */
    clearDirIntensity: 1.0,
    /** Directional light intensity multiplier in rain */
    rainDirIntensity: 0.55,
    /** Directional light intensity multiplier in fog */
    fogDirIntensity: 0.45,
    /** Directional light intensity multiplier in storm */
    stormDirIntensity: 0.35,
    /** Ambient light intensity multiplier in clear */
    clearAmbientIntensity: 1.0,
    /** Ambient light intensity multiplier in rain */
    rainAmbientIntensity: 0.75,
    /** Ambient light intensity multiplier in fog */
    fogAmbientIntensity: 0.6,
    /** Ambient light intensity multiplier in storm */
    stormAmbientIntensity: 0.45,
  },

  water: {
    /** How much rain increases water surface roughness/ripple strength */
    rainRippleStrength: 0.35,
    /** How much storm increases water surface roughness */
    stormRippleStrength: 0.6,
    /** Speed multiplier for rain-driven water */
    rainFlowSpeedMultiplier: 1.15,
    /** Speed multiplier for storm-driven water */
    stormFlowSpeedMultiplier: 1.35,
  },

  gameplay: {
    /** Extra linear damping applied during rain */
    rainDragBoost: 0.35,
    /** Extra linear damping applied during storm */
    stormDragBoost: 0.65,
    /** Boost strength multiplier during rain */
    rainBoostMultiplier: 0.85,
    /** Boost strength multiplier during storm */
    stormBoostMultiplier: 0.7,
  },
} as const;

export type WeatherConfig = typeof WEATHER_CONFIG;
