import { describe, it, expect } from 'vitest';
import {
  TRESTLE_BREAK_SPEED_DRY,
  TRESTLE_BREAK_SPEED_SOAKED,
  TRESTLE_PLANK_COUNT,
  resolveTrestleSpan,
  trestleWashout,
} from './trestleSpan';
import { parseHydroEvents } from '../water/hydroEvents';
import lumberFlume from '../../maps/lumber_flume.json';
import { LUMBER_FLUME_GAP_SEGMENT_INDEX } from '../../maps/lumber_flume';

const EVENTS = parseHydroEvents((lumberFlume as { hydroEvents?: unknown }).hydroEvents);
const GAP = LUMBER_FLUME_GAP_SEGMENT_INDEX;
const FLOOD_HOUR = 14;
const DAWN_HOUR = 6;

function spanAt(hour: number, segmentState = 'Normal') {
  return resolveTrestleSpan({
    hasBridge: true,
    segmentState,
    events: EVENTS,
    segmentIndex: GAP,
    hour,
    waterWidth: 8,
    pathLength: 95,
  });
}

describe('resolveTrestleSpan', () => {
  it('renders nothing without an authored bridge', () => {
    const span = resolveTrestleSpan({
      hasBridge: false,
      segmentState: 'WashedOut',
      events: EVENTS,
      segmentIndex: GAP,
      hour: FLOOD_HOUR,
      waterWidth: 8,
      pathLength: 95,
    });
    expect(span.present).toBe(false);
    expect(span.planks).toHaveLength(0);
  });

  it('lays a full deck on a sound hour', () => {
    const span = spanAt(12);
    expect(span.present).toBe(true);
    expect(span.planks).toHaveLength(TRESTLE_PLANK_COUNT);
    expect(span.gapFraction).toBe(0);
    expect(span.breakSpeed).toBeCloseTo(TRESTLE_BREAK_SPEED_DRY, 6);
  });

  it('opens a wider gap at the flood hour than at dawn — the #399 acceptance', () => {
    const flood = spanAt(FLOOD_HOUR);
    const dawn = spanAt(DAWN_HOUR);

    expect(flood.gapFraction).toBeGreaterThan(dawn.gapFraction);
    expect(flood.gapLength).toBeGreaterThan(dawn.gapLength);
    expect(flood.planks.length).toBeLessThan(dawn.planks.length);
    // The braid at 13:00–15:00 is what does it; the dawn roughness holds the deck.
    expect(dawn.gapFraction).toBe(0);
    expect(flood.missing.length).toBeGreaterThan(0);
  });

  it('erodes from mid-span so the run-up survives longer than the middle', () => {
    const flood = spanAt(FLOOD_HOUR, 'Flooded');
    expect(flood.missing.length).toBeGreaterThan(0);
    expect(flood.missing[0]).toBeGreaterThan(0);
    expect(flood.missing[flood.missing.length - 1]).toBeLessThan(TRESTLE_PLANK_COUNT - 1);
    expect(flood.planks.some((p) => p.index === 0)).toBe(true);
  });

  it('couples forecast state on top of the events', () => {
    const normal = spanAt(FLOOD_HOUR, 'Normal').gapFraction;
    const high = spanAt(FLOOD_HOUR, 'HighFlow').gapFraction;
    const washed = spanAt(FLOOD_HOUR, 'WashedOut').gapFraction;
    expect(high).toBeGreaterThan(normal);
    expect(washed).toBeGreaterThan(high);
  });

  it('honours an already-forced washedOutGap even at a calm hour', () => {
    const forced = resolveTrestleSpan({
      hasBridge: true,
      segmentState: 'Normal',
      washedOutGap: true,
      events: EVENTS,
      segmentIndex: GAP,
      hour: DAWN_HOUR,
      waterWidth: 8,
      pathLength: 95,
    });
    expect(forced.gapFraction).toBeGreaterThan(0);
  });

  it('softens the break speed as the deck washes out', () => {
    expect(spanAt(FLOOD_HOUR, 'WashedOut').breakSpeed).toBeLessThan(
      spanAt(DAWN_HOUR).breakSpeed,
    );
    expect(spanAt(FLOOD_HOUR, 'WashedOut').breakSpeed).toBeGreaterThanOrEqual(
      TRESTLE_BREAK_SPEED_SOAKED,
    );
  });

  it('ignores events authored for other segments', () => {
    const elsewhere = trestleWashout({
      segmentState: 'Normal',
      events: EVENTS,
      segmentIndex: GAP + 3,
      hour: FLOOD_HOUR,
    });
    expect(elsewhere).toBe(0);
  });

  it('clamps washout to 0–1', () => {
    const span = resolveTrestleSpan({
      hasBridge: true,
      segmentState: 'WashedOut',
      events: [
        { id: 'x', kind: 'braid', segmentIndex: GAP, strength: 99, radius: 9 },
      ],
      segmentIndex: GAP,
      hour: 0,
      waterWidth: 8,
      pathLength: 95,
    });
    expect(span.washout).toBe(1);
    expect(span.planks).toHaveLength(0);
    expect(span.gapFraction).toBe(1);
  });
});
