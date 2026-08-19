import { describe, expect, it } from 'vitest';
import {
  CACHE_LOST_PENALTY,
  canPlaceCache,
  countLostCaches,
  createPortageCacheRunState,
  pendingRetrievalBonus,
  placeCache,
  reducePortageCacheState,
  requiresPortageForSegment,
  totalCacheRetrievalBonus,
} from './portageCache';

const FIXTURE = {
  cacheSlots: [
    {
      id: 'ridge-10',
      segmentIndex: 10,
      label: 'Rim shelf',
      retrievalBonus: 250,
    },
    {
      id: 'ledge-12',
      segmentIndex: 12,
      label: 'Side ledge',
      retrievalBonus: 180,
    },
  ],
  portageRoutes: [{ segmentIndex: 11, label: 'High-line portage' }],
};

describe('portageCache state machine', () => {
  it('places up to the configured max caches', () => {
    const initial = createPortageCacheRunState(FIXTURE);
    expect(canPlaceCache(initial, 'ridge-10', 1)).toBe(true);
    const placed = placeCache(initial, 'ridge-10', 1);
    expect(canPlaceCache(placed, 'ledge-12', 1)).toBe(false);
    expect(placed.cacheSlots.find((slot) => slot.id === 'ridge-10')?.status).toBe('placed');
  });

  it('retrieves placed caches on segment enter and tracks bonuses', () => {
    let state = placeCache(createPortageCacheRunState(FIXTURE), 'ridge-10', 1);
    state = reducePortageCacheState(state, {
      type: 'ENTER_SEGMENT',
      segmentIndex: 10,
      requiresPortage: false,
    });

    const slot = state.cacheSlots.find((entry) => entry.id === 'ridge-10');
    expect(slot?.status).toBe('retrieved');
    expect(pendingRetrievalBonus(state, 10)).toBe(250);
    expect(totalCacheRetrievalBonus(state)).toBe(250);
  });

  it('marks caches lost and portage failed on wipeout', () => {
    let state = placeCache(createPortageCacheRunState(FIXTURE), 'ridge-10', 1);
    state = reducePortageCacheState(state, {
      type: 'ENTER_SEGMENT',
      segmentIndex: 11,
      requiresPortage: true,
    });
    state = reducePortageCacheState(state, { type: 'WIPEOUT', segmentIndex: 11 });

    expect(countLostCaches(state)).toBe(0);
    expect(state.portageRoutes[0]?.status).toBe('failed');

    state = reducePortageCacheState(state, { type: 'WIPEOUT', segmentIndex: 10 });
    expect(countLostCaches(state)).toBe(1);
    expect(CACHE_LOST_PENALTY).toBeGreaterThan(0);
  });

  it('requires portage only for elevated flow on authored segments', () => {
    expect(
      requiresPortageForSegment(FIXTURE.portageRoutes, 11, 'Normal'),
    ).toBe(false);
    expect(
      requiresPortageForSegment(FIXTURE.portageRoutes, 11, 'Flooded'),
    ).toBe(true);
    expect(
      requiresPortageForSegment(FIXTURE.portageRoutes, 10, 'Flooded'),
    ).toBe(false);
  });
});
