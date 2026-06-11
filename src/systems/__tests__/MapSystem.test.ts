/**
 * MapSystem.test.ts
 *
 * Validates that JSONMapManager correctly loads meander_to_waterfall.json
 * and returns accurate SegmentProgressionConfig for all 23 authored segments
 * (indices 0–22), as required by the "Authored Map Validation" issue.
 */

import { JSONMapManager, DEFAULT_SEGMENT_PROGRESSION, type LevelData } from '../MapSystem';
import mapData from '../../maps/meander_to_waterfall.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cast the raw JSON import to LevelData for type-safe usage. */
const level = mapData as unknown as LevelData;

describe('JSONMapManager — meander_to_waterfall', () => {
  let manager: JSONMapManager;

  beforeAll(() => {
    manager = new JSONMapManager(level);
  });

  // -------------------------------------------------------------------------
  // Instantiation
  // -------------------------------------------------------------------------

  it('instantiates without error', () => {
    expect(manager).toBeDefined();
    expect(manager.levelData).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Segments 0–12 — The Meander (default config, no explicit JSON entries)
  // -------------------------------------------------------------------------

  it.each(Array.from({ length: 13 }, (_, i) => i))(
    'segment %d (meander) has default summer biome and low rock density',
    (i) => {
      const cfg = manager.getChunkConfig(i);
      expect(cfg.biome).toBe('summer');
      expect(cfg.type).toBe('normal');
      expect(cfg.rockDensity).toBe('low');
    }
  );

  // -------------------------------------------------------------------------
  // Segment 13 — Approach
  // -------------------------------------------------------------------------

  it('segment 13 (approach) has correct meanderStrength and verticalBias', () => {
    const cfg = manager.getChunkConfig(13);
    expect(cfg.biome).toBe('summer');
    expect(cfg.meanderStrength).toBeCloseTo(0.2);
    expect(cfg.verticalBias).toBeCloseTo(-1.2);
    expect(cfg.flowSpeed).toBeCloseTo(1.15);
  });

  // -------------------------------------------------------------------------
  // Segment 14 — The Waterfall
  // -------------------------------------------------------------------------

  it('segment 14 (waterfall) has type waterfall and verticalBias ≤ -2.5', () => {
    const cfg = manager.getChunkConfig(14);
    expect(cfg.type).toBe('waterfall');
    expect(cfg.verticalBias).toBeLessThanOrEqual(-2.5);
  });

  it('segment 14 (waterfall) has biome summer', () => {
    const cfg = manager.getChunkConfig(14);
    expect(cfg.biome).toBe('summer');
  });

  it('segment 14 (waterfall) has 400 particles and camera shake', () => {
    const cfg = manager.getChunkConfig(14);
    expect(cfg.particleCount).toBe(400);
    expect(cfg.cameraShake).toBeCloseTo(0.5);
  });

  it('segment 14 (waterfall) has elevated flowSpeed', () => {
    const cfg = manager.getChunkConfig(14);
    expect(cfg.flowSpeed).toBeCloseTo(1.6);
  });

  it('segment 14 (waterfall) has gravityMultiplier of 1.45', () => {
    const cfg = manager.getChunkConfig(14);
    expect(cfg.gravityMultiplier).toBeCloseTo(1.45);
  });

  it('segment 15 (splash pool) resets gravityMultiplier to 1.0', () => {
    const cfg = manager.getChunkConfig(15);
    expect(cfg.gravityMultiplier).toBeCloseTo(1.0);
  });

  it('segments without explicit physics.gravityMultiplier return undefined', () => {
    // Segment 0 has no physics config in the JSON
    const cfg = manager.getChunkConfig(0);
    expect(cfg.gravityMultiplier).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Segment 15 — Splash Pool / biome transition
  // -------------------------------------------------------------------------

  it('segment 15 (splash pool) has type splash and autumn biome', () => {
    const cfg = manager.getChunkConfig(15);
    expect(cfg.type).toBe('splash');
    expect(cfg.biome).toBe('autumn');
  });

  it('segment 15 (splash pool) has wide canyon', () => {
    const cfg = manager.getChunkConfig(15);
    expect(cfg.width).toBe(70);
  });

  // -------------------------------------------------------------------------
  // Segments 16–18 — The Pond
  // -------------------------------------------------------------------------

  it.each([16, 17, 18])('segment %d (pond) has type pond and autumn biome', (i) => {
    const cfg = manager.getChunkConfig(i);
    expect(cfg.type).toBe('pond');
    expect(cfg.biome).toBe('autumn');
    expect(cfg.width).toBe(70);
    expect(cfg.waterWidth).toBe(28);
  });

  // -------------------------------------------------------------------------
  // Segment 19 — Autumn Rapids
  // -------------------------------------------------------------------------

  it('segment 19 (autumn rapids) has autumn biome and high rock density', () => {
    const cfg = manager.getChunkConfig(19);
    expect(cfg.biome).toBe('autumn');
    expect(cfg.rockDensity).toBe('high');
    expect(cfg.meanderStrength).toBeCloseTo(1.5);
  });

  // -------------------------------------------------------------------------
  // Segments 20–22 — Slot Canyon
  // -------------------------------------------------------------------------

  it.each([20, 21, 22])(
    'segment %d (slot canyon) has slotCanyon biome, high rock density, and narrow width',
    (i) => {
      const cfg = manager.getChunkConfig(i);
      expect(cfg.biome).toBe('slotCanyon');
      expect(cfg.rockDensity).toBe('high');
      expect(cfg.width).toBe(24);
      expect(cfg.waterWidth).toBe(8);
    }
  );

  // -------------------------------------------------------------------------
  // All 23 segments — basic contract
  // -------------------------------------------------------------------------

  it.each(Array.from({ length: 23 }, (_, i) => i))(
    'segment %d returns a valid SegmentProgressionConfig',
    (i) => {
      const cfg = manager.getChunkConfig(i);
      expect(cfg).toHaveProperty('biome');
      expect(cfg).toHaveProperty('type');
      expect(cfg).toHaveProperty('width');
      expect(cfg).toHaveProperty('rockDensity');
      expect(['low', 'high']).toContain(cfg.rockDensity);
      expect(['normal', 'waterfall', 'splash', 'pond']).toContain(cfg.type);
      expect(typeof cfg.verticalBias).toBe('number');
      expect(isFinite(cfg.verticalBias)).toBe(true);
    }
  );

  // -------------------------------------------------------------------------
  // Fallback beyond authored range
  // -------------------------------------------------------------------------

  it('segment 99 (beyond authored range) falls back and returns a valid config', () => {
    const cfg = manager.getChunkConfig(99);
    expect(cfg).toBeDefined();
    expect(cfg).toHaveProperty('biome');
    expect(cfg).toHaveProperty('type');
    expect(cfg).toHaveProperty('rockDensity');
  });

  it('returns DEFAULT_SEGMENT_PROGRESSION fields for unauthored in-range segments', () => {
    // Segments 0–12 are not listed in the JSON but are within authored range.
    const cfg = manager.getChunkConfig(0);
    expect(cfg.biome).toBe(DEFAULT_SEGMENT_PROGRESSION.biome);
    expect(cfg.type).toBe(DEFAULT_SEGMENT_PROGRESSION.type);
    expect(cfg.width).toBe(DEFAULT_SEGMENT_PROGRESSION.width);
  });
});
