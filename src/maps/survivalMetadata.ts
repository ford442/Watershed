/**
 * survivalMetadata.ts — Portage routes and cache slots per map.
 */

import type { MapRegistryId } from './registry';
import type { CacheSlotDefinition, PortageRouteDefinition } from '../systems/survival/portageCache';
import type { CheckpointDefinition } from '../systems/survival';

/**
 * Per-map survival authoring.
 *
 * Cache slots and portage routes are **spatial** when they carry an `anchor`
 * (SurvivalMarkers draws them and proximity drives the state machine) or
 * **segment-scoped** (no anchor — entering the segment is the interaction).
 * Both forms coexist; see docs/reference/SURVIVAL_LAYER.md.
 *
 * Anchors are segment-relative (`t` along the path, `lateral` metres right of
 * downstream, negative = left bank) and resolve against the live segment, so
 * they follow `?seed=`. The previous absolute `[x, y, z]` positions missed the
 * track entirely a few segments in: the treadmill descends and meanders far
 * from any fixed coordinate.
 *
 * Laterals put a waypoint on the bank — past `waterWidth / 2`, inside
 * `width / 2` — so reaching it means leaving the fast line. Checkpoints mirror
 * each map JSON's `spawns.checkpoints` segments; respawn lands on that
 * segment's spawn point (path start), so they carry no position here.
 */
export interface MapSurvivalMetadata {
  maxCachePlacements?: number;
  cacheSlots?: CacheSlotDefinition[];
  portageRoutes?: PortageRouteDefinition[];
  /** Authored respawn anchors — latest segment at or behind player wins. */
  checkpoints?: CheckpointDefinition[];
}

const SURVIVAL_BY_MAP: Partial<Record<MapRegistryId, MapSurvivalMetadata>> = {
  glacial: {
    // Cold is the verb here: trail-light kit loses core temp through the tube,
    // and the apex shelf cache is the one mid-run way to get warmth back.
    checkpoints: [
      { segment: 3, label: 'Tube entry' },
      { segment: 10, label: 'Tube apex' },
      { segment: 13, label: 'Crevasse pool' },
    ],
    maxCachePlacements: 1,
    cacheSlots: [
      {
        id: 'glacial-apex-shelf-10',
        segmentIndex: 10,
        label: 'Melt-out shelf at the tube apex',
        retrievalBonus: 260,
        // Right-bank shelf off a 5 m channel. Stash it on the way down; a
        // crevasse fall respawns at the apex (safeZone.respawnAt 10), so the
        // retrieval pass is the warm-up before the second attempt.
        anchor: { t: 0.7, lateral: 7, rise: 1.5 },
        radius: 5,
      },
    ],
    portageRoutes: [
      {
        segmentIndex: 12,
        label: 'Snow-bridge portage around the crevasse',
        // Opposite bank from the launch-shelf rock (localX −11): when the melt
        // forecast floods the jump, the snow bridge is the line.
        anchor: { t: 0.02, lateral: 9, rise: 1 },
        radius: 6,
      },
    ],
  },
  lumber: {
    checkpoints: [
      { segment: 5, label: 'Flume straight' },
      { segment: 10, label: 'Gap lip' },
      { segment: 11, label: 'Landing pool' },
    ],
    maxCachePlacements: 1,
    cacheSlots: [
      {
        id: 'lumber-bend-shelf-7',
        segmentIndex: 7,
        label: 'Timber shelf on the flume bend',
        retrievalBonus: 240,
        // Between the flume-straight checkpoint and the gap: a wipeout on the
        // high flume (8–9) respawns at 5 and runs back past it.
        anchor: { t: 0.5, lateral: 8, rise: 1 },
        radius: 5,
      },
    ],
    portageRoutes: [
      {
        segmentIndex: 10,
        label: 'Bank portage past the washed-out trestle',
        // The dry line along the bank at the gap lip. When the forecast washes
        // the trestle out, swimming the gap instead is PORTAGE FAILED.
        anchor: { t: 0.02, lateral: 10, rise: 1 },
        radius: 6,
      },
    ],
  },
  meander: {
    checkpoints: [
      { segment: 13, label: 'Approach shelf' },
      { segment: 15, label: 'Splash pool' },
    ],
    maxCachePlacements: 1,
    cacheSlots: [
      {
        id: 'meander-ridge-10',
        segmentIndex: 10,
        label: 'Rim shelf above the trestle',
        retrievalBonus: 250,
        // Bank-side shelf, off the main current line — reaching it costs speed.
        anchor: { t: 0.6, lateral: 11, rise: 2 },
        radius: 6,
      },
    ],
    portageRoutes: [
      {
        segmentIndex: 11,
        label: 'High-line portage past the trestle',
        // The dry line around the trestle. Wide radius: this is a route to steer
        // through at speed, not a spot to stop on.
        anchor: { t: 0.5, lateral: 12, rise: 2 },
        radius: 8,
      },
    ],
  },
  hydro: {
    checkpoints: [
      { segment: 4, label: 'Stilling basin' },
      { segment: 8, label: 'Outfall splash' },
    ],
    maxCachePlacements: 1,
    cacheSlots: [
      {
        id: 'hydro-catwalk-9',
        segmentIndex: 9,
        label: 'Catwalk cache above the outfall',
        retrievalBonus: 275,
        anchor: { t: 0.4, lateral: 12, rise: 2 },
        radius: 7,
      },
    ],
    portageRoutes: [
      {
        segmentIndex: 13,
        label: 'Portage ledge above the catwalk gate',
        // Dam-release set-piece: when the forecast opens the gates, this ledge is
        // the only line that isn't a wall of water.
        anchor: { t: 0.3, lateral: 13, rise: 2 },
        radius: 8,
      },
    ],
  },
  delta: {
    checkpoints: [
      { segment: 2, label: 'Raft launch' },
      { segment: 6, label: 'Open water' },
      { segment: 14, label: 'Channels rejoin' },
      { segment: 21, label: 'Beach landing' },
    ],
    maxCachePlacements: 1,
    cacheSlots: [
      {
        id: 'delta-sandbar-8',
        segmentIndex: 8,
        label: 'Sandbar cache above the braid',
        retrievalBonus: 300,
      },
    ],
    // Delta keeps the segment-scoped (non-spatial) form on purpose: it exercises
    // the legacy path, where entering the segment is the whole interaction.
    portageRoutes: [
      {
        segmentIndex: 11,
        label: 'Side washout past the forecast fork',
      },
    ],
  },
};

export function getMapSurvivalMetadata(mapId: MapRegistryId): MapSurvivalMetadata {
  return SURVIVAL_BY_MAP[mapId] ?? {};
}

export function mapHasSurvivalFeatures(mapId: MapRegistryId): boolean {
  const meta = getMapSurvivalMetadata(mapId);
  return Boolean(
    meta.cacheSlots?.length ||
      meta.portageRoutes?.length ||
      meta.checkpoints?.length,
  );
}
