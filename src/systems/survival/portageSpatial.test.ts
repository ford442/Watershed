/**
 * Spatial portage + cache loop (survival v2 phase A) and the raft paddle
 * coupling (phase C).
 *
 * The state machine is pure, so the whole loop — stash, retrieve, skip the
 * portage, wipe out with a cache down — is testable without a scene.
 */

import {
  DEFAULT_WAYPOINT_RADIUS,
  createPortageCacheRunState,
  findCacheSlotAt,
  findPortageRouteAt,
  isWithinWaypoint,
  portageRouteStatus,
  reducePortageCacheState,
  placeCache,
  isSpatialWaypoint,
  resolveWaypointPositions,
  totalCacheRetrievalBonus,
  type CacheSlotDefinition,
  type PortageRouteDefinition,
} from './portageCache';
import { getMapSurvivalMetadata, mapHasSurvivalFeatures } from '../../maps/survivalMetadata';
import glacialLevel from '../../maps/glacial_source.json';
import lumberLevel from '../../maps/lumber_flume.json';
import meanderLevel from '../../maps/meander_to_waterfall.json';
import hydroLevel from '../../maps/hydro_dam.json';
import deltaLevel from '../../maps/delta_rapids.json';
import {
  createSurvivalState,
  getLoadoutDefinition,
  getSurvivalModifiers,
  tickSurvivalState,
} from '../survival';

const SPATIAL_CACHE: CacheSlotDefinition = {
  id: 'ridge',
  segmentIndex: 10,
  label: 'Rim shelf',
  retrievalBonus: 250,
  position: [18, -14, -235],
  radius: 9,
};

const SPATIAL_ROUTE: PortageRouteDefinition = {
  segmentIndex: 11,
  label: 'High line',
  position: [22, -12, -258],
  radius: 12,
};

const SPATIAL_FIXTURE = { cacheSlots: [SPATIAL_CACHE], portageRoutes: [SPATIAL_ROUTE] };

describe('waypoint geometry', () => {
  it('tests distance in the XZ plane so height offsets do not block a shelf', () => {
    expect(isWithinWaypoint(SPATIAL_CACHE, { x: 18, y: 200, z: -235 })).toBe(true);
    expect(isWithinWaypoint(SPATIAL_CACHE, { x: 18, y: -14, z: -250 })).toBe(false);
  });

  it('treats a definition with no position as unreachable', () => {
    expect(isWithinWaypoint({ radius: 50 }, { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('defaults the radius when the author omits one', () => {
    const slot: CacheSlotDefinition = { ...SPATIAL_CACHE, radius: undefined };
    const justInside = { x: 18 + DEFAULT_WAYPOINT_RADIUS - 0.5, y: 0, z: -235 };
    const justOutside = { x: 18 + DEFAULT_WAYPOINT_RADIUS + 0.5, y: 0, z: -235 };
    expect(isWithinWaypoint(slot, justInside)).toBe(true);
    expect(isWithinWaypoint(slot, justOutside)).toBe(false);
  });

  it('picks the nearest slot when radii overlap', () => {
    const near: CacheSlotDefinition = { ...SPATIAL_CACHE, id: 'near', position: [0, 0, 0], radius: 20 };
    const far: CacheSlotDefinition = { ...SPATIAL_CACHE, id: 'far', position: [10, 0, 0], radius: 20 };
    expect(findCacheSlotAt([near, far], { x: 1, y: 0, z: 0 })?.id).toBe('near');
    expect(findCacheSlotAt([near, far], { x: 9, y: 0, z: 0 })?.id).toBe('far');
  });

  it('returns null when the player is nowhere near a waypoint', () => {
    expect(findCacheSlotAt([SPATIAL_CACHE], { x: 0, y: 0, z: 0 })).toBeNull();
    expect(findPortageRouteAt([SPATIAL_ROUTE], { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('spatial cache loop', () => {
  it('does not auto-retrieve a spatial cache on segment enter', () => {
    let state = placeCache(createPortageCacheRunState(SPATIAL_FIXTURE), 'ridge', 1);
    state = reducePortageCacheState(state, {
      type: 'ENTER_SEGMENT',
      segmentIndex: 10,
      requiresPortage: false,
    });

    expect(state.cacheSlots[0].status).toBe('placed');
    expect(totalCacheRetrievalBonus(state)).toBe(0);
  });

  it('retrieves on reaching the waypoint and banks the bonus', () => {
    let state = placeCache(createPortageCacheRunState(SPATIAL_FIXTURE), 'ridge', 1);
    state = reducePortageCacheState(state, { type: 'RETRIEVE_CACHE', slotId: 'ridge' });

    expect(state.cacheSlots[0].status).toBe('retrieved');
    expect(totalCacheRetrievalBonus(state)).toBe(250);
  });

  it('ignores retrieval of a cache that was never stashed', () => {
    const state = reducePortageCacheState(createPortageCacheRunState(SPATIAL_FIXTURE), {
      type: 'RETRIEVE_CACHE',
      slotId: 'ridge',
    });
    expect(state.cacheSlots[0].status).toBe('unplaced');
    expect(totalCacheRetrievalBonus(state)).toBe(0);
  });

  it('still auto-retrieves a segment-scoped (non-spatial) cache', () => {
    const legacy = { cacheSlots: [{ ...SPATIAL_CACHE, position: undefined }] };
    let state = placeCache(createPortageCacheRunState(legacy), 'ridge', 1);
    state = reducePortageCacheState(state, {
      type: 'ENTER_SEGMENT',
      segmentIndex: 10,
      requiresPortage: false,
    });
    expect(state.cacheSlots[0].status).toBe('retrieved');
  });
});

describe('spatial portage requirement', () => {
  const enterFlooded = () =>
    reducePortageCacheState(createPortageCacheRunState(SPATIAL_FIXTURE), {
      type: 'ENTER_SEGMENT',
      segmentIndex: 11,
      requiresPortage: true,
    });

  it('marks the route in progress on entering an elevated segment', () => {
    expect(portageRouteStatus(enterFlooded(), 11)).toBe('in_progress');
  });

  it('completes only when the player actually reaches the waypoint', () => {
    let state = enterFlooded();
    state = reducePortageCacheState(state, {
      type: 'REACH_PORTAGE_WAYPOINT',
      segmentIndex: 11,
    });
    expect(portageRouteStatus(state, 11)).toBe('completed');

    state = reducePortageCacheState(state, {
      type: 'EXIT_SEGMENT',
      segmentIndex: 11,
      survived: true,
    });
    expect(portageRouteStatus(state, 11)).toBe('completed');
  });

  it('fails a skipped portage even when the player survived the rapid', () => {
    let state = enterFlooded();
    state = reducePortageCacheState(state, {
      type: 'EXIT_SEGMENT',
      segmentIndex: 11,
      survived: true,
    });
    expect(portageRouteStatus(state, 11)).toBe('failed');
  });

  it('keeps the legacy pass-by-surviving rule for segment-scoped routes', () => {
    const legacy = { portageRoutes: [{ ...SPATIAL_ROUTE, position: undefined }] };
    let state = reducePortageCacheState(createPortageCacheRunState(legacy), {
      type: 'ENTER_SEGMENT',
      segmentIndex: 11,
      requiresPortage: true,
    });
    state = reducePortageCacheState(state, {
      type: 'EXIT_SEGMENT',
      segmentIndex: 11,
      survived: true,
    });
    expect(portageRouteStatus(state, 11)).toBe('completed');
  });

  it('does not resurrect a route that already failed', () => {
    let state = enterFlooded();
    state = reducePortageCacheState(state, { type: 'WIPEOUT', segmentIndex: 11 });
    expect(portageRouteStatus(state, 11)).toBe('failed');

    state = reducePortageCacheState(state, {
      type: 'REACH_PORTAGE_WAYPOINT',
      segmentIndex: 11,
    });
    expect(portageRouteStatus(state, 11)).toBe('failed');
  });
});

describe('authored map metadata', () => {
  it('gives meander a spatial cache and portage route to play', () => {
    const meander = getMapSurvivalMetadata('meander');
    expect(meander.cacheSlots?.[0].anchor).toBeDefined();
    expect(meander.portageRoutes?.[0].anchor).toBeDefined();
  });

  it('gives the hydro dam-release set-piece a portage line and a cache', () => {
    const hydro = getMapSurvivalMetadata('hydro');
    expect(hydro.portageRoutes?.[0].anchor).toBeDefined();
    expect(hydro.cacheSlots?.[0].anchor).toBeDefined();
  });

  it.each(['glacial', 'lumber'] as const)(
    'authors %s with checkpoints, a spatial cache and a spatial portage',
    (mapId) => {
      expect(mapHasSurvivalFeatures(mapId)).toBe(true);
      const meta = getMapSurvivalMetadata(mapId);
      expect(meta.checkpoints?.length).toBeGreaterThan(0);
      expect(meta.cacheSlots?.every(isSpatialWaypoint)).toBe(true);
      expect(meta.portageRoutes?.every(isSpatialWaypoint)).toBe(true);
    },
  );

  it('prices the lumber washed-out trestle gap with a spatial portage', () => {
    const route = getMapSurvivalMetadata('lumber').portageRoutes?.find((r) => r.segmentIndex === 10);
    expect(route?.anchor).toBeDefined();
    let state = createPortageCacheRunState(getMapSurvivalMetadata('lumber'));
    state = reducePortageCacheState(state, { type: 'ENTER_SEGMENT', segmentIndex: 10, requiresPortage: true });
    // Swimming the gap and surviving it is still PORTAGE FAILED.
    state = reducePortageCacheState(state, { type: 'EXIT_SEGMENT', segmentIndex: 10, survived: true });
    expect(portageRouteStatus(state, 10)).toBe('failed');
  });

  it('keeps a segment-scoped map authored so the legacy path stays exercised', () => {
    const delta = getMapSurvivalMetadata('delta');
    expect(delta.portageRoutes?.[0].position).toBeUndefined();
    expect(delta.portageRoutes?.[0].anchor).toBeUndefined();
    expect(isSpatialWaypoint(delta.portageRoutes![0])).toBe(false);
  });

  it('authors every cache within its own segment ordering', () => {
    for (const mapId of ['glacial', 'lumber', 'meander', 'hydro', 'delta'] as const) {
      for (const slot of getMapSurvivalMetadata(mapId).cacheSlots ?? []) {
        expect(slot.segmentIndex, `${mapId}/${slot.id}`).toBeGreaterThanOrEqual(0);
        expect(slot.retrievalBonus, `${mapId}/${slot.id}`).toBeGreaterThan(0);
      }
    }
  });

  it.each([
    ['glacial', glacialLevel],
    ['lumber', lumberLevel],
    ['meander', meanderLevel],
    ['hydro', hydroLevel],
    ['delta', deltaLevel],
  ] as const)('%s checkpoints twin the JSON spawns.checkpoints segments', (mapId, level) => {
    const jsonSegments = (level.spawns.checkpoints ?? []).map((cp) => cp.segment);
    const metaSegments = (getMapSurvivalMetadata(mapId).checkpoints ?? []).map((cp) => cp.segment);
    expect(metaSegments).toEqual(jsonSegments);
  });

  it.each([
    ['glacial', glacialLevel],
    ['lumber', lumberLevel],
    ['meander', meanderLevel],
    ['hydro', hydroLevel],
    ['delta', deltaLevel],
  ] as const)('%s safeZone.respawnAt lands on an upstream checkpoint or the segment itself', (mapId, level) => {
    const checkpoints = new Set((getMapSurvivalMetadata(mapId).checkpoints ?? []).map((cp) => cp.segment));
    for (const segment of level.segments as Array<{ index: number; safeZone?: { respawnAt?: number } }>) {
      const respawnAt = segment.safeZone?.respawnAt;
      if (respawnAt === undefined) continue;
      // Delta's beach restarts the segment in place; set-pieces go to a checkpoint.
      const ok = checkpoints.has(respawnAt) || respawnAt === segment.index;
      expect(ok, `${mapId} seg ${segment.index} → ${respawnAt}`).toBe(true);
      expect(respawnAt).toBeLessThanOrEqual(segment.index);
    }
  });
});

describe('anchored waypoint resolution', () => {
  const anchored: CacheSlotDefinition = {
    id: 'shelf',
    segmentIndex: 10,
    label: 'Shelf',
    retrievalBonus: 100,
    anchor: { t: 0.5, lateral: 7 },
  };

  it('treats an anchor as spatial state-machine-wise', () => {
    const state = createPortageCacheRunState({ cacheSlots: [anchored] });
    expect(state.cacheSlots[0].spatial).toBe(true);
  });

  it('resolves anchors on live segments and drops ones whose segment is off the treadmill', () => {
    const resolved = resolveWaypointPositions([anchored, { ...anchored, id: 'far', segmentIndex: 30 }], (index) =>
      index === 10 ? [1, 2, 3] : null,
    );
    expect(resolved.map((w) => [w.id, w.position])).toEqual([['shelf', [1, 2, 3]]]);
  });

  it('passes an absolute position through unchanged', () => {
    const resolved = resolveWaypointPositions([SPATIAL_CACHE], () => null);
    expect(resolved[0].position).toEqual(SPATIAL_CACHE.position);
  });
});

describe('glacial loadout decides the core-temp tick', () => {
  it('trail-light kit runs colder than expedition through the glacialMelt tube', () => {
    const tick = (loadoutId: 'trail-light' | 'expedition') => {
      let state = createSurvivalState();
      for (let i = 0; i < 40; i += 1) {
        state = tickSurvivalState(
          state,
          { dt: 0.5, biomeId: 'glacialMelt', inWater: i % 3 === 0, windSpeed: 6, launchHour: 6 },
          getLoadoutDefinition(loadoutId),
        );
      }
      return state.coreTemp;
    };
    expect(tick('trail-light')).toBeLessThan(tick('expedition'));
  });
});

describe('raft paddle survival coupling', () => {
  const loadout = getLoadoutDefinition('balanced');

  it('sits at the loadout baseline when dry and thermally neutral', () => {
    const mods = getSurvivalModifiers({ wetness: 0, coreTemp: 0.9 }, 'canyonSummer', loadout);
    expect(mods.paddleCostMultiplier).toBeCloseTo(loadout.staminaDrainMultiplier, 5);
    expect(mods.paddleRegenMultiplier).toBeCloseTo(loadout.staminaRegenMultiplier, 5);
  });

  it('starts a fresh run within a few percent of baseline', () => {
    // A fresh state is coreTemp 1, which computeExposureStress reads as a touch
    // of heat stress (pre-existing Track A behavior, visible on the HUD bar).
    // The paddle economy should barely notice it.
    const mods = getSurvivalModifiers(createSurvivalState(), 'canyonSummer', loadout);
    expect(mods.paddleCostMultiplier / loadout.staminaDrainMultiplier).toBeLessThan(1.05);
    expect(mods.paddleRegenMultiplier / loadout.staminaRegenMultiplier).toBeGreaterThan(0.95);
  });

  it('makes strokes cost more and refill slower when soaked', () => {
    const dry = getSurvivalModifiers({ wetness: 0, coreTemp: 1 }, 'canyonSummer', loadout);
    const soaked = getSurvivalModifiers({ wetness: 1, coreTemp: 1 }, 'canyonSummer', loadout);

    expect(soaked.paddleCostMultiplier).toBeGreaterThan(dry.paddleCostMultiplier);
    expect(soaked.paddleRegenMultiplier).toBeLessThan(dry.paddleRegenMultiplier);
  });

  it('compounds wetness with cold exposure on a glacier reach', () => {
    const warm = getSurvivalModifiers({ wetness: 0.8, coreTemp: 1 }, 'canyonSummer', loadout);
    const frozen = getSurvivalModifiers({ wetness: 0.8, coreTemp: 0.2 }, 'glacier', loadout);

    expect(frozen.paddleCostMultiplier).toBeGreaterThan(warm.paddleCostMultiplier);
    expect(frozen.paddleRegenMultiplier).toBeLessThan(warm.paddleRegenMultiplier);
  });

  it('keeps the modifiers inside playable bounds at worst case', () => {
    const worst = getSurvivalModifiers({ wetness: 1, coreTemp: 0 }, 'glacier', loadout);
    // Never free, never punishing enough to make a rapid unwinnable.
    expect(worst.paddleCostMultiplier).toBeGreaterThan(1);
    expect(worst.paddleCostMultiplier).toBeLessThan(2);
    expect(worst.paddleRegenMultiplier).toBeGreaterThanOrEqual(0);
    expect(worst.paddleRegenMultiplier).toBeLessThan(1);
  });

  it('reflects the loadout baseline in both paddle modifiers', () => {
    const expedition = getLoadoutDefinition('expedition');
    const state = { wetness: 0.5, coreTemp: 0.5 };
    const balancedMods = getSurvivalModifiers(state, 'glacier', loadout);
    const expeditionMods = getSurvivalModifiers(state, 'glacier', expedition);

    expect(expeditionMods.paddleCostMultiplier / balancedMods.paddleCostMultiplier).toBeCloseTo(
      expedition.staminaDrainMultiplier / loadout.staminaDrainMultiplier,
      5,
    );
  });
});
