/**
 * forecastCachePlacement — FlowForecast v2 leftover (#391 Phase A3).
 *
 * Survival caches stay authored in survivalMetadata.ts. They are not generated
 * from a 24h forecast mesh. When the launch-hour forecast is Flooded or
 * WashedOut, authored spatial waypoints shift toward high ground so the
 * stash is still reachable after the channel rises.
 */

import { FLOW_FORECAST_STATES, type FlowForecastState } from './flowForecast';
import type { CacheSlotDefinition, PortageRouteDefinition } from '../survival/portageCache';

const HIGH_GROUND_OFFSET_X = 4;

function isElevated(state: FlowForecastState | string): boolean {
  return state === FLOW_FORECAST_STATES.FLOODED || state === FLOW_FORECAST_STATES.WASHED_OUT;
}

function offsetWaypoint<T extends { position?: [number, number, number] }>(
  item: T,
  elevated: boolean,
): T {
  if (!elevated || !item.position) return item;
  const [x, y, z] = item.position;
  const sign = x === 0 ? 1 : Math.sign(x);
  return {
    ...item,
    position: [x + sign * HIGH_GROUND_OFFSET_X, y, z],
  };
}

export function applyForecastToCacheSlots(
  slots: readonly CacheSlotDefinition[] | undefined,
  forecastState: FlowForecastState | string,
): CacheSlotDefinition[] {
  const elevated = isElevated(forecastState);
  return (slots ?? []).map((slot) => offsetWaypoint(slot, elevated));
}

export function applyForecastToPortageRoutes(
  routes: readonly PortageRouteDefinition[] | undefined,
  forecastState: FlowForecastState | string,
): PortageRouteDefinition[] {
  const elevated = isElevated(forecastState);
  return (routes ?? []).map((route) => offsetWaypoint(route, elevated));
}
