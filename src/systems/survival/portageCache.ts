/**
 * portageCache.ts — Pure cache placement / retrieval state machine for a single run.
 *
 * Run-scoped state lives in runSession.ts; this module is pure logic + tests.
 */

export type CacheSlotStatus = 'unplaced' | 'placed' | 'retrieved' | 'lost';

export type PortageRouteStatus = 'idle' | 'required' | 'in_progress' | 'completed' | 'failed';

/** World-space waypoint an authored survival feature can occupy. */
export interface SurvivalWaypoint {
  /** World position [x, y, z]. Omit for a segment-scoped (non-spatial) feature. */
  position?: [number, number, number];
  /** Interaction radius in metres. Defaults to DEFAULT_WAYPOINT_RADIUS. */
  radius?: number;
}

export interface CacheSlotDefinition extends SurvivalWaypoint {
  id: string;
  segmentIndex: number;
  label: string;
  retrievalBonus: number;
}

export interface PortageRouteDefinition extends SurvivalWaypoint {
  segmentIndex: number;
  label: string;
}

export interface CacheSlotState {
  id: string;
  segmentIndex: number;
  status: CacheSlotStatus;
  retrievalBonus: number;
  /** True when the slot has an authored world position (spatial interaction). */
  spatial: boolean;
}

export interface PortageRouteState {
  segmentIndex: number;
  status: PortageRouteStatus;
  /** True when the route has an authored waypoint the player must actually reach. */
  spatial: boolean;
}

export interface PortageCacheRunState {
  cacheSlots: CacheSlotState[];
  portageRoutes: PortageRouteState[];
}

export type PortageCacheEvent =
  | { type: 'PLACE_CACHE'; slotId: string }
  | { type: 'ENTER_SEGMENT'; segmentIndex: number; requiresPortage: boolean }
  | { type: 'EXIT_SEGMENT'; segmentIndex: number; survived: boolean }
  | { type: 'WIPEOUT'; segmentIndex: number }
  /** Player reached a spatial cache waypoint and picked the cache up. */
  | { type: 'RETRIEVE_CACHE'; slotId: string }
  /** Player walked the authored portage line for this segment. */
  | { type: 'REACH_PORTAGE_WAYPOINT'; segmentIndex: number };

export const DEFAULT_MAX_CACHE_PLACEMENTS = 1;

export const CACHE_LOST_PENALTY = 300;
export const PORTAGE_FAIL_PENALTY = 200;

/** Interaction radius for an authored waypoint that doesn't specify one. */
export const DEFAULT_WAYPOINT_RADIUS = 6;

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
      spatial: Boolean(slot.position),
    })),
    portageRoutes: (options.portageRoutes ?? []).map((route) => ({
      segmentIndex: route.segmentIndex,
      status: 'idle',
      spatial: Boolean(route.position),
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
      // Segment-scoped slots are collected by entering the segment. Spatial slots
      // have an authored waypoint and are collected by RETRIEVE_CACHE instead —
      // otherwise the marker would pop the moment the segment streams in.
      for (const slot of next.cacheSlots) {
        if (
          !slot.spatial &&
          slot.segmentIndex === event.segmentIndex &&
          slot.status === 'placed'
        ) {
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
        // A spatial route is only completed by actually reaching its waypoint
        // (REACH_PORTAGE_WAYPOINT sets 'completed' before we get here). Surviving
        // the rapid you were supposed to portage around is a fail, not a pass —
        // that is what makes the choice cost something.
        route.status = !route.spatial && event.survived ? 'completed' : 'failed';
      }
      return next;
    }

    case 'RETRIEVE_CACHE': {
      const slot = next.cacheSlots.find((entry) => entry.id === event.slotId);
      if (slot && slot.status === 'placed') {
        slot.status = 'retrieved';
      }
      return next;
    }

    case 'REACH_PORTAGE_WAYPOINT': {
      const route = next.portageRoutes.find((entry) => entry.segmentIndex === event.segmentIndex);
      if (route && route.status !== 'failed') {
        route.status = 'completed';
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

// ---------------------------------------------------------------------------
// Spatial helpers — pure geometry, no THREE dependency so they stay testable.
// ---------------------------------------------------------------------------

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** Squared XZ distance — vertical offset is ignored so a rim shelf still triggers. */
function planarDistanceSq(point: WorldPoint, position: [number, number, number]): number {
  const dx = point.x - position[0];
  const dz = point.z - position[2];
  return dx * dx + dz * dz;
}

/** True when `point` is inside the waypoint's interaction radius (XZ plane). */
export function isWithinWaypoint(waypoint: SurvivalWaypoint, point: WorldPoint): boolean {
  if (!waypoint.position) return false;
  const radius = waypoint.radius ?? DEFAULT_WAYPOINT_RADIUS;
  return planarDistanceSq(point, waypoint.position) <= radius * radius;
}

/**
 * The cache slot whose waypoint contains `point`, or null. When several overlap,
 * the nearest wins so a dense authoring cluster still behaves predictably.
 */
export function findCacheSlotAt<T extends CacheSlotDefinition>(
  slots: ReadonlyArray<T>,
  point: WorldPoint,
): T | null {
  let best: T | null = null;
  let bestDistSq = Infinity;

  for (const slot of slots) {
    if (!slot.position || !isWithinWaypoint(slot, point)) continue;
    const distSq = planarDistanceSq(point, slot.position);
    if (distSq < bestDistSq) {
      best = slot;
      bestDistSq = distSq;
    }
  }

  return best;
}

/** The portage route whose waypoint contains `point`, or null. */
export function findPortageRouteAt<T extends PortageRouteDefinition>(
  routes: ReadonlyArray<T>,
  point: WorldPoint,
): T | null {
  for (const route of routes) {
    if (isWithinWaypoint(route, point)) return route;
  }
  return null;
}

/** Routes the player still owes on this segment (required or under way). */
export function pendingPortageRoutes(
  state: PortageCacheRunState,
): ReadonlyArray<PortageRouteState> {
  return state.portageRoutes.filter(
    (route) => route.status === 'required' || route.status === 'in_progress',
  );
}

/** Status of a single route, or null when the segment has no authored route. */
export function portageRouteStatus(
  state: PortageCacheRunState,
  segmentIndex: number,
): PortageRouteStatus | null {
  return (
    state.portageRoutes.find((route) => route.segmentIndex === segmentIndex)?.status ?? null
  );
}

/** Cache slots that can still be interacted with (drawn as world markers). */
export function activeCacheSlots(
  state: PortageCacheRunState,
): ReadonlyArray<CacheSlotState> {
  return state.cacheSlots.filter(
    (slot) => slot.status === 'unplaced' || slot.status === 'placed',
  );
}
