/**
 * journeyHandoff.ts — Runtime handoff protocol for multi-map / multi-reach journeys.
 *
 * Coordinates prefetch + continuity planning; scene mutation stays in
 * ReachManager / TrackManager / useExperienceWorld. (The reach/map boundary
 * and journey-handoff window events it used to emit had no listener and were
 * removed in #503 C; the kickoff's return value is the handoff.)
 */

import type { MapRegistryId } from '../../maps/registry';
import {
  planBiomeTransitionKickoff,
  planMapHandoff,
  type HandoffPlan,
} from './journeyContinuity';

/**
 * Prefetch next reach assets (no-op when already cached). Safe outside useFrame.
 * Returns null when the Reach API is unavailable (404 → procedural is OK).
 */
export async function prefetchNextReach(
  nextReachId: string | null | undefined,
): Promise<{ reachId: string; ok: boolean; error?: string } | null> {
  if (!nextReachId) return null;
  // The streamer (fetch + validate + loaders) is a Reach-only chunk; the campaign maps never prefetch.
  const { ReachStreamer } = await import('../reach/ReachStreamer');
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
 * Build the full handoff kickoff for an authored map pair.
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
