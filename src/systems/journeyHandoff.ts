/**
 * journeyHandoff.ts — Runtime handoff protocol for multi-map / multi-reach journeys.
 *
 * Emits window CustomEvents consumed by audio, scoring, and persistence.
 * Coordinates prefetch + continuity planning; scene mutation stays in
 * ReachManager / TrackManager / useExperienceWorld.
 */

import type { MapRegistryId } from '../maps/registry';
import { getMapDefinition } from '../maps/registry';
import {
  planBiomeTransitionKickoff,
  planMapHandoff,
  type HandoffPlan,
} from './journeyContinuity';
import { ReachStreamer } from './ReachStreamer';

export const REACH_ENTER_EVENT = 'reach-enter';
export const REACH_EXIT_EVENT = 'reach-exit';
export const MAP_ENTER_EVENT = 'map-enter';
export const MAP_EXIT_EVENT = 'map-exit';
export const JOURNEY_HANDOFF_EVENT = 'journey-handoff';

export interface ReachBoundaryDetail {
  reachId: string;
  nextReachId?: string | null;
  segmentIndex: number;
  transitionType?: string;
}

export interface MapBoundaryDetail {
  mapId: MapRegistryId;
  nextMapId?: MapRegistryId | null;
  segmentIndex: number;
  plan?: HandoffPlan | null;
}

export interface JourneyHandoffDetail {
  kind: 'map' | 'reach';
  fromId: string;
  toId: string;
  segmentIndex: number;
  plan?: HandoffPlan | null;
  biomeKickoff?: ReturnType<typeof planBiomeTransitionKickoff>;
  /** True when Canvas / TrackManager React tree must stay mounted. */
  seamless: true;
}

export function emitReachExit(detail: ReachBoundaryDetail): void {
  dispatch(REACH_EXIT_EVENT, detail);
}

export function emitReachEnter(detail: ReachBoundaryDetail): void {
  dispatch(REACH_ENTER_EVENT, detail);
}

export function emitMapExit(detail: MapBoundaryDetail): void {
  dispatch(MAP_EXIT_EVENT, detail);
}

export function emitMapEnter(detail: MapBoundaryDetail): void {
  dispatch(MAP_ENTER_EVENT, detail);
}

export function emitJourneyHandoff(detail: JourneyHandoffDetail): void {
  dispatch(JOURNEY_HANDOFF_EVENT, detail);
}

/**
 * Prefetch next reach assets (no-op when already cached). Safe outside useFrame.
 * Returns null when the Reach API is unavailable (404 → procedural is OK).
 */
export async function prefetchNextReach(
  nextReachId: string | null | undefined,
): Promise<{ reachId: string; ok: boolean; error?: string } | null> {
  if (!nextReachId) return null;
  if (ReachStreamer.isReachCached(nextReachId)) {
    return { reachId: nextReachId, ok: true };
  }
  try {
    await ReachStreamer.preloadReach(nextReachId);
    return { reachId: nextReachId, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[journeyHandoff] Prefetch of reach ${nextReachId} failed (procedural OK):`, message);
    return { reachId: nextReachId, ok: false, error: message };
  }
}

/**
 * Build the full handoff kickoff for an authored map pair and emit boundary events.
 * Callers still apply biome crossfade + map manager swap.
 */
export function kickoffMapHandoff(options: {
  fromMapId: MapRegistryId;
  toMapId: MapRegistryId;
  segmentIndex: number;
  lastWidth?: number;
  lastWaterWidth?: number;
}): {
  plan: HandoffPlan;
  biomeKickoff: ReturnType<typeof planBiomeTransitionKickoff>;
} | null {
  const plan = planMapHandoff({
    fromMapId: options.fromMapId,
    toMapId: options.toMapId,
    lastSegmentIndex: options.segmentIndex,
    lastWidth: options.lastWidth,
    lastWaterWidth: options.lastWaterWidth,
  });
  if (!plan) return null;

  const biomeKickoff = planBiomeTransitionKickoff(
    plan.initialBiome,
    plan.biomeTransitionSeconds,
  );

  emitMapExit({
    mapId: options.fromMapId,
    nextMapId: options.toMapId,
    segmentIndex: options.segmentIndex,
    plan,
  });
  emitJourneyHandoff({
    kind: 'map',
    fromId: options.fromMapId,
    toId: options.toMapId,
    segmentIndex: options.segmentIndex,
    plan,
    biomeKickoff,
    seamless: true,
  });
  emitMapEnter({
    mapId: options.toMapId,
    nextMapId: getContinuationTargetSafe(options.toMapId),
    segmentIndex: plan.nextMapStartIndex,
    plan,
  });

  return { plan, biomeKickoff };
}

/**
 * Resolve next reach id from a manifest transition (optional authored field).
 * Falls back to `transition.nextReachId` when present on the typed extension.
 */
export function resolveNextReachId(
  transition: { nextReachId?: string; type?: string } | null | undefined,
  fallback?: string | null,
): string | null {
  if (transition?.nextReachId) return transition.nextReachId;
  return fallback ?? null;
}

function getContinuationTargetSafe(mapId: MapRegistryId): MapRegistryId | null {
  const def = getMapDefinition(mapId);
  if (def.nextMapId) return def.nextMapId;
  return def.continuation?.mapId ?? null;
}

function dispatch(name: string, detail: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
