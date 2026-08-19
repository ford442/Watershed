/**
 * MapSystem — delta_rapids.json climax map validation + registry wiring
 */

import { JSONMapManager, ProceduralMapManager, type LevelData } from './MapSystem';
import deltaData from '../../maps/delta_rapids.json';
import hydroData from '../../maps/hydro_dam.json';
import {
  DELTA_BEACH_SEGMENT_INDEX,
  DELTA_BRAID_WASH_SEGMENT_INDEX,
  DELTA_OPEN_WATER_SEGMENT_INDEX,
  DELTA_RAFT_SWAP_SEGMENT_INDEX,
  DELTA_RAPIDS_CONTINUED_START_INDEX,
  DELTA_RAPIDS_SEGMENT_COUNT,
} from '../../maps/delta_rapids';
import {
  MAP_REGISTRY,
  getMapDefinition,
  resolveMapRegistryId,
} from '../../maps/registry';
import { getMapSurvivalMetadata } from '../../maps/survivalMetadata';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { getBiomePalette } from '../../configs/BiomePalettes';
import { getJourneyCompletionDecision } from '../../maps/campaign';

const deltaLevel = deltaData as unknown as LevelData;
const hydroLevel = hydroData as unknown as LevelData;

describe('JSONMapManager — delta_rapids climax', () => {
  let manager: JSONMapManager;

  beforeAll(() => {
    manager = new JSONMapManager(deltaLevel);
  });

  it('authors a full finale (~18–24 segments) without stub metadata', () => {
    expect(manager.levelData?.world.track.totalSegments).toBe(DELTA_RAPIDS_SEGMENT_COUNT);
    expect(manager.levelData?.segments.length).toBe(DELTA_RAPIDS_SEGMENT_COUNT);
    expect(deltaLevel.metadata.tags).not.toContain('stub');
    expect(deltaLevel.metadata.tags).toEqual(
      expect.arrayContaining(['delta', 'raft', 'finale', 'beach']),
    );
    expect(deltaLevel.metadata.estimatedDuration).toBeGreaterThanOrEqual(300);
    expect(deltaLevel.metadata.difficulty).toBe('intermediate');
  });

  it('opens from canyon mouth into wide delta water with raft force', () => {
    const mouth = manager.getChunkConfig(0);
    expect(mouth.biome).toBe('delta');
    expect(mouth.width).toBeGreaterThanOrEqual(70);

    const raft = manager.getChunkConfig(DELTA_RAFT_SWAP_SEGMENT_INDEX);
    expect(raft.type).toBe('pond');
    expect(raft.forceVehicle).toBe('raft');
    expect(raft.width).toBeGreaterThanOrEqual(100);
    expect(raft.waterWidth).toBeGreaterThanOrEqual(40);
    expect(raft.flowSpeed).toBeLessThan(0.5);
  });

  it('open-water beat is wide and calm', () => {
    const cfg = manager.getChunkConfig(DELTA_OPEN_WATER_SEGMENT_INDEX);
    expect(cfg.type).toBe('pond');
    expect(cfg.width).toBeGreaterThanOrEqual(110);
    expect(cfg.waterWidth).toBeGreaterThanOrEqual(60);
    expect(cfg.flowSpeed).toBeLessThanOrEqual(0.3);
  });

  it('braided washout carries forecast-washable bridge', () => {
    const cfg = manager.getChunkConfig(DELTA_BRAID_WASH_SEGMENT_INDEX);
    expect(cfg.hasBridge).toBe(true);
    expect(cfg.forceVehicle).toBe('raft');
  });

  it('beach segment completes the journey', () => {
    const cfg = manager.getChunkConfig(DELTA_BEACH_SEGMENT_INDEX);
    expect(cfg.journeyComplete).toBe(true);
    expect(cfg.type).toBe('splash');
    expect(cfg.biome).toBe('delta');
    expect(cfg.forceVehicle).toBe('raft');
  });

  it('spawns include beach checkpoint metadata', () => {
    const beach = deltaLevel.spawns.checkpoints?.find((c) => c.segment === DELTA_BEACH_SEGMENT_INDEX);
    expect(beach).toBeDefined();
    expect(beach?.radius).toBeGreaterThanOrEqual(40);
  });
});

describe('ProceduralMapManager — hydro → delta chaining', () => {
  const manager = new ProceduralMapManager(
    hydroLevel,
    [],
    {},
    { levelData: deltaLevel, startIndex: DELTA_RAPIDS_CONTINUED_START_INDEX },
  );

  it('segment 16 resolves via delta continuation as canyon mouth into delta', () => {
    const cfg = manager.getChunkConfig(16);
    expect(cfg.biome).toBe('delta');
    expect(cfg.width).toBeGreaterThanOrEqual(70);
  });
});

describe('MAP_REGISTRY — delta entry', () => {
  it('registers delta as terminal campaign finale with raft preference', () => {
    const def = getMapDefinition('delta');
    expect(def.id).toBe('delta');
    expect(def.label).toBe('River Delta');
    expect(def.initialBiome).toBe('delta');
    expect(def.preferredVehicle).toBe('raft');
    expect(def.difficulty).toBe('intermediate');
    expect(def.estimatedDurationSec).toBe(360);
    expect(def.unlockAfter).toBe('hydro');
    expect(def.nextMapId).toBeUndefined();
    expect(def.levelData.world.track.totalSegments).toBe(DELTA_RAPIDS_SEGMENT_COUNT);
    expect(MAP_REGISTRY.delta).toBe(def);
    expect(getJourneyCompletionDecision('delta')).toEqual({ kind: 'summary' });
  });

  it('resolveMapRegistryId accepts delta', () => {
    expect(resolveMapRegistryId('delta')).toBe('delta');
    expect(resolveMapRegistryId('DELTA')).toBe('delta');
  });

  it('survival metadata includes beach checkpoint', () => {
    const meta = getMapSurvivalMetadata('delta');
    expect(meta.checkpoints?.some((c) => c.segment === DELTA_BEACH_SEGMENT_INDEX)).toBe(true);
    expect(meta.checkpoints?.find((c) => c.segment === DELTA_BEACH_SEGMENT_INDEX)?.label).toMatch(
      /beach/i,
    );
  });
});

describe('delta biome profile + palette', () => {
  it('uses low walls and wide canyon geometry', () => {
    const profile = getTrackBiomeProfile('delta');
    expect(profile.canyonWidth).toBeGreaterThanOrEqual(90);
    expect(profile.wallHeight).toBeLessThanOrEqual(10);
    expect(profile.decorationBias.reeds).toBeGreaterThan(1);
  });

  it('palette is warm sunset, not midday blue', () => {
    const palette = getBiomePalette('delta');
    expect(palette.lightTemp).toBeLessThan(4000);
    expect(palette.flowSpeed).toBeLessThan(0.4);
    expect(palette.sunColor.toLowerCase()).not.toBe('#ffffff');
  });
});
