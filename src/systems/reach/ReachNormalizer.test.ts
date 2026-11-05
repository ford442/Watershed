/**
 * ReachNormalizer — a validated Reach manifest → TrackManager segments.
 *
 * Pins today's contract that `manifest.segments[i]` is segment `i` (array
 * position, not `.index`). reachValidator guarantees the indices are exactly
 * 0..totalSegments-1 (schema minimum 0, count + duplicate + gap checks), so a
 * sparse or negative-index reach cannot validate; an out-of-order one can, and
 * the last describe records what it does (a finding, not fixed here).
 */
import * as THREE from 'three';
import { normalizeReachManifest } from './ReachNormalizer';
import type { ReachManifest, ReachSegment } from './ReachStreamer';
import { validateReach } from '../../utils/reachValidator';
import { applyForecastToSegmentParams, FLOW_FORECAST_STATES } from '../map/flowForecast';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';

const { NORMAL, FLOODED, WASHED_OUT } = FLOW_FORECAST_STATES;

function makeReach(segments: ReachSegment[]): ReachManifest {
  return {
    reachId: 'normalizer-test',
    metadata: {
      name: 'Normalizer Test',
      author: 'Test',
      difficulty: 'beginner',
      estimatedDuration: 120,
      version: '1.0.0',
    },
    world: {
      track: {
        waypoints: [
          [0, 0, 0],
          [0, -5, -30],
          [10, -10, -80],
          [-5, -15, -140],
        ],
        segmentLength: 30,
        totalSegments: segments.length,
      },
      biome: {
        baseType: 'canyonSummer',
        sky: { color: '#87CEEB' },
        fog: { color: '#D4E9F7', near: 50, far: 200 },
        lighting: { sunIntensity: 1.4, sunAngle: 45 },
        water: { tint: '#1a6b8a', flowSpeed: 1.5 },
      },
    },
    segments,
    spawns: { start: { position: [0, -4, 5] } },
    requiredAssets: { textures: [], models: [], audio: [], shaders: [] },
    transition: { segmentIndex: segments.length - 1, type: 'waterfall', durationSeconds: 5 },
  };
}

const dense = (): ReachSegment[] => [
  { index: 0, difficulty: 0.2, decorations: { trees: 10 } },
  { index: 1, difficulty: 0.4, type: 'rapids', width: 40, forwardMomentum: 1.2, decorations: { trees: 25 } },
  { index: 2, difficulty: 0.6, biomeOverride: 'autumn', hasBridge: true, decorations: {} },
];

const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('normalizeReachManifest — a dense, in-order manifest', () => {
  it('validates, and array position agrees with .index', () => {
    const reach = makeReach(dense());
    expect(validateReach(reach).valid).toBe(true);
    const out = normalizeReachManifest(reach);
    expect(out.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(out.map((s) => s.config.index)).toEqual([0, 1, 2]);
  });

  it('samples 4 finite points per segment, joined end to start', () => {
    const out = normalizeReachManifest(makeReach(dense()));
    for (const seg of out) {
      expect(seg.points).toHaveLength(4);
      expect(seg.points.every(finite)).toBe(true);
    }
    for (let i = 1; i < out.length; i++) {
      expect(out[i].points[0].distanceTo(out[i - 1].points[3])).toBeLessThan(1e-9);
    }
    expect(out[0].points[0].toArray()).toEqual([0, 0, 0]);
  });

  it('defaults at the read site from the biome profile and never writes into the manifest', () => {
    const reach = makeReach(dense());
    const before = structuredClone(reach.segments);
    const [first, second, third] = normalizeReachManifest(reach);
    const summer = getTrackBiomeProfile('canyonSummer');

    expect(first.type).toBe('normal');
    expect(first.width).toBe(summer.canyonWidth);
    expect(first.waterWidth).toBe(summer.waterWidth);
    expect(first.flowSpeed).toBeCloseTo(1.5);
    expect(first.forwardMomentum).toBe(1);
    expect(first.meanderStrength).toBe(1.2);
    expect(first.verticalBias).toBe(-0.5);
    expect(first.treeDensity).toBeCloseTo(10 / 50);

    expect(second.type).toBe('rapids');
    expect(second.width).toBe(40);
    expect(second.flowSpeed).toBeCloseTo(1.5 * 1.2);

    expect(third.biome).toBe('canyonAutumn');
    expect(third.wallProfile).toBe(getTrackBiomeProfile('canyonAutumn'));

    expect(reach.segments).toEqual(before);
  });

  it('applies a per-index forecast from the pre-forecast base', () => {
    const forecastByIndex = new Map([[1, FLOODED], [2, WASHED_OUT]]);
    const out = normalizeReachManifest(makeReach(dense()), undefined, { forecastByIndex });
    expect(out.map((s) => s.segmentState)).toEqual([NORMAL, FLOODED, WASHED_OUT]);
    const expected = applyForecastToSegmentParams(out[1]._forecastBase!, FLOODED);
    expect(out[1].width).toBeCloseTo(expected.width);
    expect(out[1]._forecastBase!.width).toBe(40);
    // WashedOut on an authored bridge opens a gap.
    expect(out[2].washedOutGap).toBe(true);
  });

  it('honours an authored washedOutGap at a Normal forecast', () => {
    const segments = dense();
    segments[0] = { ...segments[0], washedOutGap: true };
    const reach = makeReach(segments);
    expect(validateReach(reach).valid).toBe(true);
    const [first] = normalizeReachManifest(reach);
    expect(first._forecastBase!.washedOutGap).toBe(true);
    expect(first.washedOutGap).toBe(true);
  });

  it('a legacy single forecastState string still applies to every segment', () => {
    const out = normalizeReachManifest(makeReach(dense()), undefined, FLOODED);
    expect(out.every((s) => s.segmentState === FLOODED)).toBe(true);
  });

  it('nudges segment 0 along the previous segment’s end tangent', () => {
    const first = normalizeReachManifest(makeReach(dense()));
    const previous = first[first.length - 1];
    const chained = normalizeReachManifest(makeReach(dense()), previous);
    const tangent = new THREE.Vector3().subVectors(previous.points[3], previous.points[2]).normalize();
    const expected = first[0].points[0].clone().add(tangent.multiplyScalar(0.01));
    expect(chained[0].points[0].distanceTo(expected)).toBeLessThan(1e-9);
    expect(chained[1].points[0].equals(first[1].points[0])).toBe(true);
  });

  it('skips (with a warning) an array slot past the end of segments[]', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reach = makeReach(dense());
    reach.world.track.totalSegments = 4;
    const out = normalizeReachManifest(reach);
    expect(out.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('index 3'));
    warn.mockRestore();
  });
});

describe('normalizeReachManifest — finding: array position, not .index', () => {
  it('a sparse or negative-index reach does not validate (so never reaches the normalizer)', () => {
    const sparse = dense().map((s, i) => ({ ...s, index: i * 2 }));
    expect(validateReach(makeReach(sparse)).valid).toBe(false);
    const negative = dense().map((s, i) => ({ ...s, index: i - 1 }));
    expect(validateReach(makeReach(negative)).valid).toBe(false);
  });

  it('an out-of-order reach validates, and segment i takes segments[i]’s config (today)', () => {
    const [a, b, c] = dense();
    const shuffled = makeReach([b, a, c]);
    expect(validateReach(shuffled).valid).toBe(true);
    const out = normalizeReachManifest(shuffled);
    // id is the array position; the config is whichever entry sits there.
    expect(out.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(out.map((s) => s.config.index)).toEqual([1, 0, 2]);
    expect(out[0].type).toBe('rapids');
  });
});
