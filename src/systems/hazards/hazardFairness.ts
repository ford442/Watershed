/**
 * hazardFairness — which hazards a run's river carries, for ghost fairness (#578 A).
 *
 * A hazard changes the river it is live on: the 14:00 dam release sends a
 * routed surge through the basin. So a 14:00 hydro run with the release and
 * one recorded before it existed are not the same race, and the hazards live at
 * the launch hour fold into the hydro hash next to the weather and the
 * conditions (raceFairness `currentRunFairness`). '' when none is live, so
 * every map, hour and stored ghost without a live hazard hashes exactly as it
 * did before hazards existed.
 *
 * On the entry path, so it reads the authored JSON as is (the parser rides in
 * the lazy hazard runtime): liveness is the runtime's own rule (hazardHours),
 * and a live hazard keys by its authored record, so any change to it re-keys.
 */
import type { HydroEvent } from '../water/hydroEvents';
import { isHazardLiveAtHour } from './hazardHours';
import type { HazardConfig } from './hazardTypes';

type AuthoredHazard = Pick<HazardConfig, 'id' | 'hours' | 'hydroEventId'>;

const isAuthored = (item: unknown): item is AuthoredHazard =>
  !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string';

/** The live hazards' part of a run's fairness key: their authored records, by id. */
export function hazardsFairnessPart(raw: unknown, hydroEvents: readonly HydroEvent[], hour: number): string {
  if (!Array.isArray(raw)) return '';
  const live = raw
    .filter(isAuthored)
    .filter((hazard) => isHazardLiveAtHour(hazard, hour, hydroEvents))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return live.length === 0 ? '' : `hazards:${JSON.stringify(live)}`;
}
