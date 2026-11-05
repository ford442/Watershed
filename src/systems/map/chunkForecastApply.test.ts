/**
 * chunkForecastApply — the pure chunk → SegmentData step ChunkManager runs, and
 * the live forecast re-application that must never compound.
 */
import * as THREE from 'three';
import {
  applyLiveForecast,
  baseChunkToSegmentData,
  createSegmentData,
  type SegmentData,
} from './chunkForecastApply';
import { FLOW_FORECAST_STATES, applyForecastToSegmentParams } from './flowForecast';
import {
  buildProceduralSegment,
  DEFAULT_SEGMENT_PROGRESSION,
  INITIAL_TREADMILL_POINTS,
  ProceduralMapManager,
  resolveGameplayProfile,
  type BaseMapChunk,
  type LevelData,
} from './MapSystem';
import meanderData from '../../maps/meander_to_waterfall.json';
import lumberData from '../../maps/lumber_flume.json';

const meander = meanderData as unknown as LevelData;
const lumber = lumberData as unknown as LevelData;
const { NORMAL, HIGH_FLOW, FLOODED, WASHED_OUT } = FLOW_FORECAST_STATES;

function chunkFor(level: LevelData | null, index: number) {
  const manager = new ProceduralMapManager(level);
  return { manager, ...buildProceduralSegment(index, null, manager) };
}

function chunkWithConfig(config: BaseMapChunk['config']): BaseMapChunk {
  const { chunk } = chunkFor(null, 0);
  return { ...chunk, config };
}

describe('baseChunkToSegmentData', () => {
  it('Normal: passes the progression through and keeps the pre-forecast base', () => {
    const { chunk, progression } = chunkFor(meander, 3);
    const seg = baseChunkToSegmentData(chunk, progression, NORMAL);
    expect(seg.id).toBe(3);
    expect(seg.type).toBe(progression.type);
    expect(seg.width).toBe(progression.width);
    expect(seg.waterWidth).toBe(progression.waterWidth);
    expect(seg.flowSpeed).toBe(progression.flowSpeed);
    expect(seg.segmentState).toBe(NORMAL);
    expect(seg.points).toBe(chunk.pathPoints);
    expect(seg.segmentPath).toBe(chunk.curve);
    expect(seg._baseChunk).toBe(chunk);
    expect(seg.washedOutGap).toBe(false);
    expect(seg._forecastBase).toMatchObject({
      type: progression.type,
      width: progression.width,
      waterWidth: progression.waterWidth,
      flowSpeed: progression.flowSpeed,
    });
    expect(seg.gameplay).toEqual(resolveGameplayProfile(progression));
  });

  it.each([HIGH_FLOW, FLOODED, WASHED_OUT])('%s: matches applyForecastToSegmentParams on the same base', (state) => {
    const { chunk, progression } = chunkFor(meander, 5);
    const seg = baseChunkToSegmentData(chunk, progression, state);
    const expected = applyForecastToSegmentParams(seg._forecastBase!, state);
    expect(seg.segmentState).toBe(state);
    expect(seg.width).toBeCloseTo(expected.width);
    expect(seg.waterWidth).toBeCloseTo(expected.waterWidth);
    expect(seg.flowSpeed).toBeCloseTo(expected.flowSpeed);
    expect(seg.particleCount).toBe(expected.particleCount);
    expect(seg.rockDensity).toBe(expected.rockDensity);
    expect(seg.type).toBe(expected.type);
    expect(seg.washedOutGap).toBe(expected.washedOutGap);
    // The forecast base is the authored value, never the multiplied one.
    expect(seg._forecastBase!.width).toBe(progression.width);
  });

  it('WashedOut opens the floor; an authored openFloor stays open at Normal', () => {
    const prog = { ...DEFAULT_SEGMENT_PROGRESSION };
    const washed = baseChunkToSegmentData(chunkWithConfig(undefined), prog, WASHED_OUT);
    expect(washed.washedOutGap).toBe(true);
    expect(washed.config?.openFloor).toBe(true);

    const authored = baseChunkToSegmentData(chunkWithConfig({ openFloor: true }), prog, NORMAL);
    expect(authored.washedOutGap).toBe(false);
    expect(authored.config?.openFloor).toBe(true);

    const closed = baseChunkToSegmentData(chunkWithConfig(undefined), prog, NORMAL);
    expect(closed.config?.openFloor).toBe(false);
  });

  it('carries hasBridge and an already-forced washedOutGap from the chunk config', () => {
    const prog = { ...DEFAULT_SEGMENT_PROGRESSION };
    const bridged = baseChunkToSegmentData(chunkWithConfig({ hasBridge: true }), prog, NORMAL);
    expect(bridged.config?.hasBridge).toBe(true);
    expect(bridged._forecastBase?.hasBridge).toBe(true);
    expect(bridged.washedOutGap).toBe(false);

    // washedOutGap is not in BaseMapChunk.config's type; the reader probes for it.
    const forcedConfig = { hasBridge: false, washedOutGap: true };
    const forced = baseChunkToSegmentData(chunkWithConfig(forcedConfig), prog, NORMAL);
    expect(forced.washedOutGap).toBe(true);
    expect(forced.config?.openFloor).toBe(true);
  });

  it('the authored lumber trestle segments keep their bridge', () => {
    const manager = new ProceduralMapManager(lumber);
    const bridged = lumber.segments.filter((s) => s.hasBridge).map((s) => s.index);
    expect(bridged.length).toBeGreaterThan(0);
    for (const index of bridged) {
      const { chunk, progression } = buildProceduralSegment(index, null, manager);
      expect(baseChunkToSegmentData(chunk, progression, NORMAL).config?.hasBridge).toBe(true);
    }
  });
});

describe('applyLiveForecast', () => {
  function base(state: string = NORMAL): SegmentData {
    const { chunk, progression } = chunkFor(meander, 6);
    return baseChunkToSegmentData(chunk, progression, state);
  }

  it('re-applies from the base: Normal → Flooded → Flooded equals Normal → Flooded', () => {
    const once = applyLiveForecast(base(), FLOODED);
    const twice = applyLiveForecast(once, FLOODED);
    expect(twice.width).toBeCloseTo(once.width);
    expect(twice.flowSpeed).toBeCloseTo(once.flowSpeed);
    expect(twice.particleCount).toBe(once.particleCount);
  });

  it('a live state equals building with that state directly', () => {
    for (const state of [HIGH_FLOW, FLOODED, WASHED_OUT]) {
      const live = applyLiveForecast(base(NORMAL), state);
      const direct = base(state);
      expect(live.width).toBeCloseTo(direct.width);
      expect(live.waterWidth).toBeCloseTo(direct.waterWidth);
      expect(live.flowSpeed).toBeCloseTo(direct.flowSpeed);
      expect(live.type).toBe(direct.type);
      expect(live.segmentState).toBe(direct.segmentState);
      expect(live.washedOutGap).toBe(direct.washedOutGap);
    }
  });

  it('back to Normal restores the authored values', () => {
    const start = base();
    const back = applyLiveForecast(applyLiveForecast(start, WASHED_OUT), NORMAL);
    expect(back.width).toBeCloseTo(start.width);
    expect(back.type).toBe(start.type);
    expect(back.washedOutGap).toBe(false);
    expect(back.config?.openFloor).toBe(false);
  });

  it('without a forecast base only the state is updated', () => {
    const seg = { ...base(), _forecastBase: undefined };
    const out = applyLiveForecast(seg, FLOODED);
    expect(out.segmentState).toBe(FLOODED);
    expect(out.width).toBe(seg.width);
    expect(out.type).toBe(seg.type);
  });

  it('does not mutate its input', () => {
    const seg = base();
    const snapshot = { width: seg.width, state: seg.segmentState, config: { ...seg.config } };
    applyLiveForecast(seg, WASHED_OUT);
    expect(seg.width).toBe(snapshot.width);
    expect(seg.segmentState).toBe(snapshot.state);
    expect(seg.config).toEqual(snapshot.config);
  });
});

describe('createSegmentData', () => {
  it('index 0 with no previous segment starts on the initial treadmill points', () => {
    const manager = new ProceduralMapManager(meander);
    const seg = createSegmentData(0, null, NORMAL, manager);
    expect(seg.points[0].equals(INITIAL_TREADMILL_POINTS[INITIAL_TREADMILL_POINTS.length - 1])).toBe(true);
  });

  it('chains: each segment starts where the last ended (within the continuity nudge)', () => {
    const manager = new ProceduralMapManager(meander);
    let prev: SegmentData | null = null;
    for (let i = 0; i < 20; i++) {
      const seg = createSegmentData(i, prev, NORMAL, manager, true);
      expect(seg.points.every((p: THREE.Vector3) => Number.isFinite(p.x + p.y + p.z))).toBe(true);
      if (prev) expect(seg.points[0].distanceTo(prev.points[prev.points.length - 1])).toBeLessThanOrEqual(0.0101);
      prev = seg;
    }
  });

  it('is deterministic per base seed', () => {
    const manager = new ProceduralMapManager(meander);
    const a = createSegmentData(4, null, NORMAL, manager, false, 11);
    const b = createSegmentData(4, null, NORMAL, manager, false, 11);
    const c = createSegmentData(4, null, NORMAL, manager, false, 12);
    expect(a.points.map((p) => p.toArray())).toEqual(b.points.map((p) => p.toArray()));
    expect(c.points.map((p) => p.toArray())).not.toEqual(a.points.map((p) => p.toArray()));
  });
});
