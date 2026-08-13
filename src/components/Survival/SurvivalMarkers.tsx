/**
 * SurvivalMarkers — world markers + interaction for spatial caches and portage routes.
 *
 * This is the piece that turns the portage/cache state machine into something the
 * player can actually walk to. It renders one marker per authored waypoint on the
 * active map and drives the state machine from proximity:
 *
 *   - **Cache slot, unplaced** → entering the radius stashes the cache (score slot
 *     spent now, insurance banked for later).
 *   - **Cache slot, placed** → entering the radius retrieves it: score bonus plus
 *     the wetness/warmth relief in `applyCacheRecovery()`.
 *   - **Portage route** → only shown while the segment's forecast state actually
 *     demands it. Reaching it completes the route; leaving the segment without it
 *     is a `PORTAGE FAILED` penalty (see `useExperienceLifecycle`).
 *
 * Interaction is proximity-only by design — no interact key. The player is moving
 * at speed down a river; a prompt they must read and press is the wrong verb, and
 * "steer through the marker" is the same verb the rest of the game uses.
 *
 * Markers are cheap (one instanced-free mesh each, a handful per map) and only
 * exist while a run session has authored waypoints.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getMapSurvivalMetadata } from '../../maps/survivalMetadata';
import {
  DEFAULT_WAYPOINT_RADIUS,
  findCacheSlotAt,
  findPortageRouteAt,
  portageRouteStatus,
  type CacheSlotDefinition,
  type CacheSlotStatus,
  type PortageRouteDefinition,
} from '../../systems/portageCache';
import {
  applyCacheRecovery,
  dispatchPortageCacheEvent,
  getPortageCacheState,
  getRunSession,
} from '../../systems/runSession';
import { awardCacheRetrievalBonus } from '../../systems/ScoreSystem';
import { useGameStore } from '../../systems/GameState';
import type { VehicleRigidBodyRef } from '../../experience/types';

/** How often to test the player against waypoints (seconds). 10 Hz is plenty. */
const PROXIMITY_INTERVAL = 0.1;

const CACHE_COLOR_UNPLACED = '#f5c542';
const CACHE_COLOR_PLACED = '#6dde7a';
const PORTAGE_COLOR = '#9fd6ff';

export interface SurvivalMarkersProps {
  vehicleRef: React.RefObject<VehicleRigidBodyRef | null>;
}

interface MarkerVisual {
  key: string;
  position: [number, number, number];
  radius: number;
  color: string;
  label: string;
}

/** Emit a HUD toast without coupling this component to the HUD implementation. */
function announce(label: string, detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('survival-marker', { detail: { label, ...detail } }),
  );
}

export function SurvivalMarkers({ vehicleRef }: SurvivalMarkersProps) {
  const session = getRunSession();
  const mapId = session?.mapId;
  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);

  const metadata = useMemo(
    () => (mapId ? getMapSurvivalMetadata(mapId) : {}),
    [mapId],
  );

  /** Authored waypoints only — segment-scoped entries have no marker to draw. */
  const spatialCaches = useMemo<CacheSlotDefinition[]>(
    () => (metadata.cacheSlots ?? []).filter((slot) => Boolean(slot.position)),
    [metadata],
  );
  const spatialRoutes = useMemo<PortageRouteDefinition[]>(
    () => (metadata.portageRoutes ?? []).filter((route) => Boolean(route.position)),
    [metadata],
  );

  // Re-render markers when slot statuses change; the state machine itself lives
  // outside React, so this mirrors just enough of it to draw.
  const [slotStatuses, setSlotStatuses] = useState<Record<string, CacheSlotStatus>>({});
  const elapsedRef = useRef(0);

  useEffect(() => {
    const runState = getPortageCacheState();
    if (!runState) return;
    const next: Record<string, CacheSlotStatus> = {};
    for (const slot of runState.cacheSlots) next[slot.id] = slot.status;
    setSlotStatuses(next);
  }, [mapId]);

  useFrame((_state, delta) => {
    if (spatialCaches.length === 0 && spatialRoutes.length === 0) return;

    elapsedRef.current += delta;
    if (elapsedRef.current < PROXIMITY_INTERVAL) return;
    elapsedRef.current = 0;

    const body = vehicleRef.current;
    const position = body?.translation?.();
    if (!position) return;

    const runState = getPortageCacheState();
    if (!runState) return;

    // --- caches ---
    const nearCache = findCacheSlotAt(spatialCaches, position);
    if (nearCache) {
      const slot = runState.cacheSlots.find((entry) => entry.id === nearCache.id);

      if (slot?.status === 'unplaced') {
        dispatchPortageCacheEvent({ type: 'PLACE_CACHE', slotId: nearCache.id });
        setSlotStatuses((prev) => ({ ...prev, [nearCache.id]: 'placed' }));
        announce('CACHE STASHED', { slotId: nearCache.id, cacheLabel: nearCache.label });
      } else if (slot?.status === 'placed') {
        dispatchPortageCacheEvent({ type: 'RETRIEVE_CACHE', slotId: nearCache.id });
        awardCacheRetrievalBonus(slot.segmentIndex);
        applyCacheRecovery();
        setSlotStatuses((prev) => ({ ...prev, [nearCache.id]: 'retrieved' }));
        announce('CACHE RETRIEVED', { slotId: nearCache.id, cacheLabel: nearCache.label });
      }
    }

    // --- portage routes ---
    const nearRoute = findPortageRouteAt(spatialRoutes, position);
    if (nearRoute) {
      const status = portageRouteStatus(runState, nearRoute.segmentIndex);
      if (status === 'required' || status === 'in_progress') {
        dispatchPortageCacheEvent({
          type: 'REACH_PORTAGE_WAYPOINT',
          segmentIndex: nearRoute.segmentIndex,
        });
        announce('PORTAGE CLEARED', { segmentIndex: nearRoute.segmentIndex });
      }
    }
  });

  const markers = useMemo<MarkerVisual[]>(() => {
    const runState = getPortageCacheState();
    const visuals: MarkerVisual[] = [];

    for (const slot of spatialCaches) {
      const status = slotStatuses[slot.id]
        ?? runState?.cacheSlots.find((entry) => entry.id === slot.id)?.status
        ?? 'unplaced';
      // Retrieved and lost caches leave nothing behind to walk to.
      if (status !== 'unplaced' && status !== 'placed') continue;
      visuals.push({
        key: `cache-${slot.id}`,
        position: slot.position!,
        radius: slot.radius ?? DEFAULT_WAYPOINT_RADIUS,
        color: status === 'placed' ? CACHE_COLOR_PLACED : CACHE_COLOR_UNPLACED,
        label: slot.label,
      });
    }

    for (const route of spatialRoutes) {
      const status = portageRouteStatus(runState ?? { cacheSlots: [], portageRoutes: [] }, route.segmentIndex);
      // Only draw a portage line the player currently owes — an idle route would
      // read as "go this way" on a segment that is perfectly runnable.
      if (status !== 'required' && status !== 'in_progress') continue;
      visuals.push({
        key: `portage-${route.segmentIndex}`,
        position: route.position!,
        radius: route.radius ?? DEFAULT_WAYPOINT_RADIUS,
        color: PORTAGE_COLOR,
        label: route.label,
      });
    }

    return visuals;
  }, [spatialCaches, spatialRoutes, slotStatuses, currentSegmentIndex]);

  if (markers.length === 0) return null;

  return (
    <group name="survival-markers">
      {markers.map((marker) => (
        <group key={marker.key} position={marker.position}>
          {/* Ground ring — reads as "stand here" from above and at speed. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[marker.radius * 0.75, marker.radius, 24]} />
            <meshBasicMaterial
              color={marker.color}
              transparent
              opacity={0.35}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          {/* Beacon — visible over the canyon lip before the ring is in view. */}
          <mesh position={[0, 3, 0]}>
            <cylinderGeometry args={[0.25, 0.25, 6, 8]} />
            <meshBasicMaterial color={marker.color} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default SurvivalMarkers;
