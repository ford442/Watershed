/**
 * MapSystem — lumber_flume.json validation + registry wiring
 */

import { JSONMapManager, ProceduralMapManager, type LevelData } from '../MapSystem';
import lumberData from '../../maps/lumber_flume.json';
import meanderData from '../../maps/meander_to_waterfall.json';
import {
  LUMBER_FLUME_GAP_SEGMENT_INDEX,
  LUMBER_FLUME_LANDING_SEGMENT_INDEX,
  LUMBER_FLUME_SEGMENT_COUNT,
} from '../../maps/lumber_flume';
import {
  MAP_REGISTRY,
  getMapDefinition,
  resolveMapRegistryId,
} from '../../maps/registry';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { getBiomePalette } from '../../configs/BiomePalettes';
import { validateLevel } from '../../utils/levelValidator';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../VehicleSystem';

const lumberLevel = lumberData as unknown as LevelData;
const meanderLevel = meanderData as unknown as LevelData;

describe('JSONMapManager — lumber_flume', () => {
  let manager: JSONMapManager;

  beforeAll(() => {
    manager = new JSONMapManager(lumberLevel);
  });

  it('instantiates with 16 authored segments', () => {
    expect(manager.levelData?.world.track.totalSegments).toBe(LUMBER_FLUME_SEGMENT_COUNT);
    expect(manager.levelData?.segments.length).toBe(LUMBER_FLUME_SEGMENT_COUNT);
  });

  it('segment 0 uses lumberFlume biome with forest approach density', () => {
    const cfg = manager.getChunkConfig(0);
    expect(cfg.biome).toBe('lumberFlume');
    expect(cfg.treeDensity).toBeGreaterThanOrEqual(14);
    expect(cfg.flowSpeed).toBeGreaterThan(0.8);
  });

  it('gap segment is an open-floor waterfall with launch shelf', () => {
    const cfg = manager.getChunkConfig(LUMBER_FLUME_GAP_SEGMENT_INDEX);
    expect(cfg.type).toBe('waterfall');
    expect(cfg.openFloor).toBe(true);
    expect(cfg.launchShelf).toBeDefined();
    expect(cfg.verticalBias).toBeLessThanOrEqual(-2.5);
  });

  it('landing segment is a splash pool after the gap', () => {
    const cfg = manager.getChunkConfig(LUMBER_FLUME_LANDING_SEGMENT_INDEX);
    expect(cfg.type).toBe('splash');
    expect(cfg.width).toBeGreaterThanOrEqual(35);
  });

  it('final segment handoffs toward summer meander', () => {
    const cfg = manager.getChunkConfig(15);
    expect(cfg.biome).toBe('canyonSummer');
  });
});

describe('ProceduralMapManager — lumber → meander chaining', () => {
  const manager = new ProceduralMapManager(
    lumberLevel,
    [],
    {},
    { levelData: meanderLevel, startIndex: 0 },
  );

  it('segment 16 resolves to meander segment 0 (summer meander)', () => {
    const cfg = manager.getChunkConfig(16);
    expect(cfg.biome).toBe('canyonSummer');
    expect(cfg.treeDensity).toBeGreaterThanOrEqual(10);
  });
});

describe('MAP_REGISTRY — lumber entry', () => {
  it('registers lumber with lumberFlume initial biome and meander continuation', () => {
    const def = getMapDefinition('lumber');
    expect(def.id).toBe('lumber');
    expect(def.initialBiome).toBe('lumberFlume');
    expect(def.levelData.world.track.totalSegments).toBe(16);
    expect(def.continuation?.levelData).toBeDefined();
    expect(MAP_REGISTRY.lumber).toBe(def);
  });

  it('resolveMapRegistryId accepts lumber / flume aliases', () => {
    expect(resolveMapRegistryId('lumber')).toBe('lumber');
    expect(resolveMapRegistryId('lumberFlume')).toBe('lumber');
    expect(resolveMapRegistryId('flume')).toBe('lumber');
    expect(resolveMapRegistryId('LUMBER')).toBe('lumber');
    expect(resolveMapRegistryId('unknown-map')).toBeNull();
  });
});

describe('lumberFlume biome profile + palette', () => {
  it('has a distinct track profile vs summer canyon', () => {
    const lumber = getTrackBiomeProfile('lumberFlume');
    const summer = getTrackBiomeProfile('canyonSummer');
    expect(lumber.id).toBe('lumberFlume');
    expect(lumber.wallHeight).toBeLessThan(summer.wallHeight);
    expect(lumber.vegetationDensity).toBeGreaterThan(summer.vegetationDensity);
    expect(lumber.rockBaseColor).not.toBe(summer.rockBaseColor);
  });

  it('palette reads as damp wood greens with strong sun shafts', () => {
    const palette = getBiomePalette('lumberFlume');
    expect(palette.id).toBe('lumberFlume');
    expect(palette.sunShaftIntensity).toBeGreaterThanOrEqual(0.9);
    expect(palette.treeDensity).toBeGreaterThan(1.2);
    expect(palette.name).toMatch(/lumber/i);
  });

  it('maps surface friction to wood', () => {
    expect(MATERIAL_FROM_BIOME.lumberFlume).toBe(SurfaceMaterial.WOOD);
  });
});

describe('lumber_flume.json schema validation', () => {
  it('validates against the level schema', () => {
    const result = validateLevel(lumberData);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
