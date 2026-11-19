/**
 * hazardHours — which launch hours a hazard is live at (#522 A), on its own so
 * the entry chunk can ask (ghost fairness, hazardFairness.ts) without the
 * lifecycle, which only the lazy hazard runtime carries.
 */
import { isHydroEventActiveAtHour, normalizeHour, type HydroEvent } from '../water/hydroEvents';
import type { HazardConfig } from './hazardTypes';

/**
 * Whether a hazard runs at all on a run launched at `hour`. One that follows a
 * hydro event is live exactly when that event is (and, if it also names
 * `hours`, at those of them); a missing event id means never — the registry
 * contract test keeps authored maps from shipping one.
 */
export function isHazardLiveAtHour(
  config: Pick<HazardConfig, 'hours' | 'hydroEventId'>,
  hour: number,
  hydroEvents: readonly HydroEvent[],
): boolean {
  const h = normalizeHour(hour);
  const hours = Array.isArray(config.hours) ? config.hours : null;
  if (hours && hours.length > 0 && !hours.some((c) => normalizeHour(c) === h)) return false;
  if (config.hydroEventId === undefined) return true;
  const event = hydroEvents.find((e) => e.id === config.hydroEventId);
  return event !== undefined && isHydroEventActiveAtHour(event, h);
}
