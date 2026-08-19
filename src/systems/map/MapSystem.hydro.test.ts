/**
 * MapSystem — hydro_dam.json validation + registry wiring
 */

import { JSONMapManager, ProceduralMapManager, type LevelData } from './MapSystem';
import hydroData from '../../maps/hydro_dam.json';
import deltaData from '../../maps/delta_rapids.json';
import {
  HYDRO_DAM_BASIN_SEGMENT_INDEX,
  HYDRO_DAM_CATWALK_SEGMENT_INDEX,
  HYDRO_DAM_PIPE_SEGMENT_INDEX,
  HYDRO_DAM_SEGMENT_COUNT,
  HYDRO_DAM_VORTEX_SEGMENT_INDEX,
} from '../../maps/hydro_dam';
import {
  MAP_REGISTRY,
  getMapDefinition,
  resolveMapRegistryId,
} from '../../maps/registry';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { getBiomePalette } from '../../configs/BiomePalettes';
import { validateLevel } from '../../utils/levelValidator';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../vehicle/VehicleSystem';
import {
  DELTA_RAPIDS_CONTINUED_START_INDEX,
} from '../../maps/meander_to_waterfall';

const hydroLevel = hydroData as unknown as LevelData;
const deltaLevel = deltaData as unknown as LevelData;

describe('JSONMapManager — hydro_dam', () => {
  let manager: JSONMapManager;

  beforeAll(() => {
    manager = new JSONMapManager(hydroLevel);
  });

  it('instantiates with 16 authored segments', () => {
    expect(manager.levelData?.world.track.totalSegments).toBe(HYDRO_DAM_SEGMENT_COUNT);
    expect(manager.levelData?.segments.length).toBe(HYDRO_DAM_SEGMENT_COUNT);
  });

  it('segment 0 uses hydroDam biome with concrete approach density', () => {
    const cfg = manager.getChunkConfig(0);
    expect(cfg.biome).toBe('hydroDam');
    expect(cfg.treeDensity).toBeLessThanOrEqual(4);
    expect(cfg.flowSpeed).toBeGreaterThan(1);
  });

  it('stilling basin is a wide pond checkpoint segment', () => {
    const cfg = manager.getChunkConfig(HYDRO_DAM_BASIN_SEGMENT_INDEX);
    expect(cfg.type).toBe('pond');
    expect(cfg.width).toBeGreaterThanOrEqual(50);
  });

  it('vortex chamber carries authored vortex field', () => {
    const cfg = manager.getChunkConfig(HYDRO_DAM_VORTEX_SEGMENT_INDEX);
    expect(cfg.type).toBe('pond');
    expect(cfg.vortex).toBeDefined();
    expect(cfg.vortex?.radius).toBeGreaterThan(5);
    expect(cfg.vortex?.downwardForce).toBeGreaterThan(0);
  });

  it('overflow pipe is an open-floor waterfall', () => {
    const cfg = manager.getChunkConfig(HYDRO_DAM_PIPE_SEGMENT_INDEX);
    expect(cfg.type).toBe('waterfall');
    expect(cfg.openFloor).toBe(true);
    expect(cfg.verticalBias).toBeLessThanOrEqual(-2.5);
  });

  it('catwalk gate has a forecast-washable bridge', () => {
    const cfg = manager.getChunkConfig(HYDRO_DAM_CATWALK_SEGMENT_INDEX);
    expect(cfg.hasBridge).toBe(true);
  });

  it('final segment handoffs toward delta with journeyComplete', () => {
    const cfg = manager.getChunkConfig(15);
    expect(cfg.biome).toBe('delta');
    expect(cfg.journeyComplete).toBe(true);
  });
});

describe('ProceduralMapManager — hydro → delta chaining', () => {
  const manager = new ProceduralMapManager(
    hydroLevel,
    [],
    {},
    { levelData: deltaLevel, startIndex: DELTA_RAPIDS_CONTINUED_START_INDEX },
  );

  it('segment 16 resolves via delta continuation', () => {
    const cfg = manager.getChunkConfig(16);
    // delta_rapids.json segment 0 is authored as canyon mouth into wide delta
    expect(cfg.biome).toBe('delta');
    expect(cfg.width).toBeGreaterThanOrEqual(70);
  });
});

describe('MAP_REGISTRY — hydro entry', () => {
  it('registers hydro with hydroDam initial biome and delta continuation', () => {
    const def = getMapDefinition('hydro');
    expect(def.id).toBe('hydro');
    expect(def.initialBiome).toBe('hydroDam');
    expect(def.levelData.world.track.totalSegments).toBe(16);
    expect(def.nextMapId).toBe('delta');
    expect(def.unlockAfter).toBe('meander');
    expect(def.continuation?.mapId).toBe('delta');
    expect(MAP_REGISTRY.hydro).toBe(def);
  });

  it('resolveMapRegistryId accepts hydro / dam aliases', () => {
    expect(resolveMapRegistryId('hydro')).toBe('hydro');
    expect(resolveMapRegistryId('hydroDam')).toBe('hydro');
    expect(resolveMapRegistryId('dam')).toBe('hydro');
    expect(resolveMapRegistryId('HYDRO')).toBe('hydro');
    expect(resolveMapRegistryId('unknown-map')).toBeNull();
  });
});

describe('hydroDam biome profile + palette', () => {
  it('has a distinct concrete track profile vs summer canyon', () => {
    const hydro = getTrackBiomeProfile('hydroDam');
    const summer = getTrackBiomeProfile('canyonSummer');
    expect(hydro.id).toBe('hydroDam');
    expect(hydro.vegetationDensity).toBeLessThan(summer.vegetationDensity);
    expect(hydro.wallTightness).toBeGreaterThan(summer.wallTightness);
    expect(hydro.rockBaseColor).not.toBe(summer.rockBaseColor);
  });

  it('palette reads as industrial concrete / metal', () => {
    const palette = getBiomePalette('hydroDam');
    expect(palette.id).toBe('hydroDam');
    expect(palette.treeDensity).toBeLessThan(0.2);
    expect(palette.name).toMatch(/hydro/i);
  });

  it('maps surface friction to concrete', () => {
    expect(MATERIAL_FROM_BIOME.hydroDam).toBe(SurfaceMaterial.CONCRETE);
  });
});

describe('hydro_dam.json schema validation', () => {
  it('validates against the level schema', () => {
    const result = validateLevel(hydroData);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
