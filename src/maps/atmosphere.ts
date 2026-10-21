/**
 * atmosphere.ts — where on Earth (and when in the year) each map's sky is.
 *
 * The sun is computed, not authored (systems/sky/sunPosition.ts): a map only
 * names its latitude and the day of the year its biome reads as, and how fast
 * its clock runs. The campaign is one late-summer alpine watershed, from the
 * glacier at ~46.5° N down to the delta at ~45° N, on 1 September (day 244):
 * a 06:00 launch meets a blue dawn (sun ~6° up), 14:00 a high afternoon sun
 * (~44°), and 17:00 the golden hour (~16°, daylight fraction ~0.87).
 */
import type { MapRegistryId } from './registry';

export interface MapAtmosphere {
  /** Degrees north (negative = south). */
  latitudeDeg: number;
  /** 1..365 — the season the sun is computed for. */
  dayOfYear: number;
  /** Game seconds per sim second: 10 = one real minute is ten game minutes. */
  timeSpeedup: number;
}

export const DEFAULT_ATMOSPHERE: Readonly<MapAtmosphere> = Object.freeze({
  latitudeDeg: 46,
  dayOfYear: 244,
  timeSpeedup: 10,
});

export const MAP_ATMOSPHERE: Readonly<Record<MapRegistryId, MapAtmosphere>> = {
  glacial: { latitudeDeg: 46.5, dayOfYear: 244, timeSpeedup: 10 },
  lumber: { latitudeDeg: 46.3, dayOfYear: 244, timeSpeedup: 10 },
  meander: { latitudeDeg: 46, dayOfYear: 244, timeSpeedup: 10 },
  hydro: { latitudeDeg: 45.6, dayOfYear: 244, timeSpeedup: 10 },
  delta: { latitudeDeg: 45.2, dayOfYear: 244, timeSpeedup: 10 },
};

export function getMapAtmosphere(mapId: string | null | undefined): MapAtmosphere {
  return (mapId && MAP_ATMOSPHERE[mapId as MapRegistryId]) || DEFAULT_ATMOSPHERE;
}
