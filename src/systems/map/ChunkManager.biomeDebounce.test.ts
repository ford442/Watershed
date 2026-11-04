/**
 * The biome debounce runs on sim time: `detectBiome(z, dt)` counts seconds, so
 * the step a biome commits on depends only on the steps run, never on how
 * much wall time passed between them (a scripted run or replay steps 60
 * frames synchronously, then waits on the harness). SimCore's `chunk-biome`
 * system calls it once per fixed step.
 */

import { ProceduralMapManager } from './MapSystem';
import { BIOME_DEBOUNCE_SEC, ChunkManager } from './ChunkManager';
import meanderLevel from '../../maps/meander_to_waterfall.json';
import { MEANDER_FALLBACK_PROGRESSION } from '../../maps/meander_to_waterfall';
import type { LevelData } from './MapSystem';
import { SimCore } from '../../sim/core/SimCore';
import { createChunkBiomeSimSystem } from './chunkBiomeSystem';
import { gameplayProfileForBiome } from '../gameplay/gameplayProfile';

const DT = 1 / 60;

function createChunks(onBiomeChange: (biome: string, segmentIndex: number) => void) {
  const mapManager = new ProceduralMapManager(meanderLevel as unknown as LevelData, MEANDER_FALLBACK_PROGRESSION, {
    seed: 12345,
  });
  const chunks = new ChunkManager({ mapManager, startIndex: -3, callbacks: { onBiomeChange } });
  chunks.initializePool();
  return chunks;
}

describe('ChunkManager biome debounce (sim time)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the spawn segment biome at pool init', () => {
    const changes: Array<[string, number]> = [];
    const chunks = createChunks((biome, index) => changes.push([biome, index]));
    expect(changes).toEqual([['glacier', -3]]);
    expect(chunks.getCurrentBiome()).toBe('glacier');
  });

  it('commits a new biome after BIOME_DEBOUNCE_SEC of stepped frames, whatever the wall clock does', () => {
    vi.useFakeTimers();
    const changes: Array<[string, number]> = [];
    const chunks = createChunks((biome, index) => changes.push([biome, index]));
    changes.length = 0;

    const next = chunks.getActiveSegments()[1];
    expect(next.biome).toBe('canyonSummer');
    const z = next.segmentPath.getPoint(0.5).z;

    const framesToCommit = Math.round(BIOME_DEBOUNCE_SEC / DT);
    for (let i = 0; i < framesToCommit - 1; i += 1) {
      chunks.detectBiome(z, DT);
      // Wall time passing between frames must not commit anything.
      vi.advanceTimersByTime(10_000);
    }
    expect(changes).toEqual([]);
    expect(chunks.getCurrentBiome()).toBe('glacier');

    chunks.detectBiome(z, DT);
    expect(changes).toEqual([['canyonSummer', next.id]]);
    expect(chunks.getCurrentBiome()).toBe('canyonSummer');
  });

  it('restarts the count when the camera drops back into the reported biome', () => {
    const changes: Array<[string, number]> = [];
    const chunks = createChunks((biome, index) => changes.push([biome, index]));
    changes.length = 0;

    const [spawn, next] = chunks.getActiveSegments();
    const zSpawn = spawn.segmentPath.getPoint(0.5).z;
    const zNext = next.segmentPath.getPoint(0.5).z;

    for (let i = 0; i < 20; i += 1) chunks.detectBiome(zNext, DT);
    chunks.detectBiome(zSpawn, DT);
    for (let i = 0; i < 20; i += 1) chunks.detectBiome(zNext, DT);
    expect(changes).toEqual([]);

    for (let i = 0; i < 10; i += 1) chunks.detectBiome(zNext, DT);
    expect(changes).toEqual([['canyonSummer', next.id]]);
  });

  it('pool upkeep (update) no longer detects biomes — the sim system does', () => {
    const changes: Array<[string, number]> = [];
    const chunks = createChunks((biome, index) => changes.push([biome, index]));
    changes.length = 0;
    const z = chunks.getActiveSegments()[1].segmentPath.getPoint(0.5).z;
    for (let i = 0; i < 60; i += 1) chunks.update(z, DT);
    expect(changes).toEqual([]);
    expect(chunks.getCurrentBiome()).toBe('glacier');
  });

  it('commits on the same step through the registered chunk-biome system', () => {
    const changes: Array<[string, number]> = [];
    const chunks = createChunks((biome, index) => changes.push([biome, index]));
    changes.length = 0;
    const next = chunks.getActiveSegments()[1];

    const core = new SimCore();
    core.register(createChunkBiomeSimSystem());
    core.ctx.camera.z = next.segmentPath.getPoint(0.5).z;

    // Not sane: the treadmill's per-frame gate also skipped detection.
    core.ctx.camera.sane = false;
    for (let i = 0; i < 40; i += 1) core.step();
    expect(changes).toEqual([]);

    core.ctx.camera.sane = true;
    const steps = Math.round(BIOME_DEBOUNCE_SEC / DT);
    for (let i = 0; i < steps - 1; i += 1) core.step();
    expect(changes).toEqual([]);
    core.step();
    expect(changes).toEqual([['canyonSummer', next.id]]);
    chunks.dispose();
  });
});

describe('ChunkManager committed gameplay profile (#521 B)', () => {
  it('commits the spawn segment profile at init and moves it with the biome commit', () => {
    const chunks = createChunks(() => {});
    expect(chunks.getCommittedGameplay()).toBe(gameplayProfileForBiome('glacier'));
    const next = chunks.getActiveSegments()[1];
    const z = next.segmentPath.getPoint(0.5).z;
    for (let i = 0; i < Math.round(BIOME_DEBOUNCE_SEC / DT); i += 1) chunks.detectBiome(z, DT);
    expect(chunks.getCommittedGameplay()).toBe(gameplayProfileForBiome('canyonSummer'));
  });

  it('debounces into a same-biome segment whose authored override differs, without a biome report', () => {
    const levelData = JSON.parse(JSON.stringify(meanderLevel)) as LevelData;
    const seg = levelData.segments.find((s) => s.index === -1)!;
    seg.gameplay = { flowCap: 2.2 };
    const mapManager = new ProceduralMapManager(levelData, MEANDER_FALLBACK_PROGRESSION, { seed: 12345 });
    const changes: string[] = [];
    const chunks = new ChunkManager({ mapManager, startIndex: -3, callbacks: { onBiomeChange: (b) => changes.push(b) } });
    chunks.initializePool();
    const [, summer, overridden] = chunks.getActiveSegments();
    const steps = Math.round(BIOME_DEBOUNCE_SEC / DT);
    for (let i = 0; i < steps; i += 1) chunks.detectBiome(summer.segmentPath.getPoint(0.5).z, DT);
    expect(changes).toEqual(['glacier', 'canyonSummer']);
    expect(chunks.getCommittedGameplay().flowCap).toBe(1.0);

    const z = overridden.segmentPath.getPoint(0.5).z;
    for (let i = 0; i < steps - 1; i += 1) chunks.detectBiome(z, DT);
    expect(chunks.getCommittedGameplay().flowCap).toBe(1.0);
    chunks.detectBiome(z, DT);
    expect(chunks.getCommittedGameplay().flowCap).toBe(2.2);
    expect(changes).toEqual(['glacier', 'canyonSummer']);
  });
});
