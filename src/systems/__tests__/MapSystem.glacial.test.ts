/**
 * MapSystem.test.ts — glacial_source.json validation
 */

import { JSONMapManager, ProceduralMapManager, type LevelData } from '../MapSystem';
import glacialData from '../../maps/glacial_source.json';
import meanderData from '../../maps/meander_to_waterfall.json';

const glacialLevel = glacialData as unknown as LevelData;
const meanderLevel = meanderData as unknown as LevelData;

describe('JSONMapManager — glacial_source', () => {
  let manager: JSONMapManager;

  beforeAll(() => {
    manager = new JSONMapManager(glacialLevel);
  });

  it('instantiates with 18 authored segments', () => {
    expect(manager.levelData?.world.track.totalSegments).toBe(18);
    expect(manager.levelData?.segments.length).toBe(18);
  });

  it('segment 0 uses glacialMelt biome and high flow', () => {
    const cfg = manager.getChunkConfig(0);
    expect(cfg.biome).toBe('glacialMelt');
    expect(cfg.flowSpeed).toBeGreaterThan(1.5);
    expect(cfg.slipperiness).toBeGreaterThan(0.7);
  });

  it('segment 10 (tube apex) is the narrowest/fastest tube section', () => {
    const cfg = manager.getChunkConfig(10);
    expect(cfg.biome).toBe('glacialMelt');
    expect(cfg.waterWidth).toBeLessThanOrEqual(6);
    expect(cfg.flowSpeed).toBeGreaterThanOrEqual(2.8);
    expect(cfg.verticalBias).toBeLessThanOrEqual(-2.3);
  });

  it('segment 12 (crevasse jump) is a waterfall with launch shelf', () => {
    const cfg = manager.getChunkConfig(12);
    expect(cfg.type).toBe('waterfall');
    expect(cfg.launchShelf).toBeDefined();
    expect(cfg.verticalBias).toBeLessThanOrEqual(-2.5);
  });

  it('segment 17 (melt-out) transitions to summer meander', () => {
    const cfg = manager.getChunkConfig(17);
    expect(cfg.biome).toBe('summer');
  });
});

describe('ProceduralMapManager — glacial → meander chaining', () => {
  const manager = new ProceduralMapManager(
    glacialLevel,
    [],
    {},
    { levelData: meanderLevel, startIndex: 0 },
  );

  it('segment 18 resolves to meander segment 0 (summer meander)', () => {
    const cfg = manager.getChunkConfig(18);
    expect(cfg.biome).toBe('summer');
    expect(cfg.treeDensity).toBeGreaterThanOrEqual(10);
  });

  it('segment 32 resolves to meander segment 14 (waterfall)', () => {
    const cfg = manager.getChunkConfig(32);
    expect(cfg.type).toBe('waterfall');
    expect(cfg.particleCount).toBe(400);
  });
});
