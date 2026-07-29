/**
 * portageCache.ts — Pure cache placement / retrieval state machine for a single run.
 *
 * Run-scoped state lives in runSession.ts; this module is pure logic + tests.
 */

export type CacheSlotStatus = 'unplaced' | 'placed' | 'retrieved' | 'lost';

export type PortageRouteStatus = 'idle' | 'required' | 'in_progress' | 'completed' | 'failed';

export interface CacheSlotDefinition {
  id: string;
  segmentIndex: number;
  label: string;
  retrievalBonus: number;
}

export interface PortageRouteDefinition {
  segmentIndex: number;
  label: string;
}

export interface CacheSlotState {
  id: string;
  segmentIndex: number;
  status: CacheSlotStatus;
  retrievalBonus: number;
}

export interface PortageRouteState {
  segmentIndex: number;
  status: PortageRouteStatus;
}

export interface PortageCacheRunState {
  cacheSlots: CacheSlotState[];
  portageRoutes: PortageRouteState[];
}

export type PortageCacheEvent =
  | { type: 'PLACE_CACHE'; slotId: string }
  | { type: 'ENTER_SEGMENT'; segmentIndex: number; requiresPortage: boolean }
  | { type: 'EXIT_SEGMENT'; segmentIndex: number; survived: boolean }
  | { type: 'WIPEOUT'; segmentIndex: number };

export const DEFAULT_MAX_CACHE_PLACEMENTS = 1;

export const CACHE_LOST_PENALTY = 300;
export const PORTAGE_FAIL_PENALTY = 200;

function cloneState(state: PortageCacheRunState): PortageCacheRunState {
  return {
    cacheSlots: state.cacheSlots.map((slot) => ({ ...slot })),
    portageRoutes: state.portageRoutes.map((route) => ({ ...route })),
  };
}

export function createPortageCacheRunState(options: {
  cacheSlots?: ReadonlyArray<CacheSlotDefinition>;
  portageRoutes?: ReadonlyArray<PortageRouteDefinition>;
}): PortageCacheRunState {
  return {
    cacheSlots: (options.cacheSlots ?? []).map((slot) => ({
      id: slot.id,
      segmentIndex: slot.segmentIndex,
      status: 'unplaced',
      retrievalBonus: slot.retrievalBonus,
    })),
    portageRoutes: (options.portageRoutes ?? []).map((route) => ({
      segmentIndex: route.segmentIndex,
      status: 'idle',
    })),
  };
}

export function countPlacedCaches(state: PortageCacheRunState): number {
  return state.cacheSlots.filter((slot) => slot.status === 'placed').length;
}

export function canPlaceCache(
  state: PortageCacheRunState,
  slotId: string,
  maxPlacements = DEFAULT_MAX_CACHE_PLACEMENTS,
): boolean {
  const slot = state.cacheSlots.find((entry) => entry.id === slotId);
  if (!slot || slot.status !== 'unplaced') return false;
  return countPlacedCaches(state) < maxPlacements;
}

export function placeCache(
  state: PortageCacheRunState,
  slotId: string,
  maxPlacements = DEFAULT_MAX_CACHE_PLACEMENTS,
): PortageCacheRunState {
  if (!canPlaceCache(state, slotId, maxPlacements)) return state;
  const next = cloneState(state);
  const slot = next.cacheSlots.find((entry) => entry.id === slotId);
  if (slot) slot.status = 'placed';
  return next;
}

export function reducePortageCacheState(
  state: PortageCacheRunState,
  event: PortageCacheEvent,
): PortageCacheRunState {
  const next = cloneState(state);

  switch (event.type) {
    case 'PLACE_CACHE': {
      const slot = next.cacheSlots.find((entry) => entry.id === event.slotId);
      if (slot && slot.status === 'unplaced') {
        slot.status = 'placed';
      }
      return next;
    }

    case 'ENTER_SEGMENT': {
      for (const slot of next.cacheSlots) {
        if (slot.segmentIndex === event.segmentIndex && slot.status === 'placed') {
          slot.status = 'retrieved';
        }
      }

      if (event.requiresPortage) {
        const route = next.portageRoutes.find((entry) => entry.segmentIndex === event.segmentIndex);
        if (route && route.status === 'idle') {
          route.status = 'required';
        }
        if (route && (route.status === 'required' || route.status === 'idle')) {
          route.status = 'in_progress';
        }
      }
      return next;
    }

    case 'EXIT_SEGMENT': {
      const route = next.portageRoutes.find((entry) => entry.segmentIndex === event.segmentIndex);
      if (!route) return next;
      if (route.status === 'in_progress' || route.status === 'required') {
        route.status = event.survived ? 'completed' : 'failed';
      }
      return next;
    }

    case 'WIPEOUT': {
      for (const slot of next.cacheSlots) {
        if (slot.segmentIndex === event.segmentIndex && slot.status === 'placed') {
          slot.status = 'lost';
        }
      }

      const route = next.portageRoutes.find((entry) => entry.segmentIndex === event.segmentIndex);
      if (route && (route.status === 'in_progress' || route.status === 'required')) {
        route.status = 'failed';
      }
      return next;
    }

    default:
      return state;
  }
}

export function requiresPortageForSegment(
  portageRoutes: ReadonlyArray<PortageRouteDefinition>,
  segmentIndex: number,
  segmentState: string,
): boolean {
  const elevated =
    segmentState === 'Flooded' || segmentState === 'WashedOut' || segmentState === 'HighFlow';
  if (!elevated) return false;
  return portageRoutes.some((route) => route.segmentIndex === segmentIndex);
}

export function totalCacheRetrievalBonus(state: PortageCacheRunState): number {
  return state.cacheSlots
    .filter((slot) => slot.status === 'retrieved')
    .reduce((sum, slot) => sum + slot.retrievalBonus, 0);
}

export function countLostCaches(state: PortageCacheRunState): number {
  return state.cacheSlots.filter((slot) => slot.status === 'lost').length;
}

export function pendingRetrievalBonus(state: PortageCacheRunState, segmentIndex: number): number {
  return state.cacheSlots
    .filter((slot) => slot.segmentIndex === segmentIndex && slot.status === 'retrieved')
    .reduce((sum, slot) => sum + slot.retrievalBonus, 0);
}
