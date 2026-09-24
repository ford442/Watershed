import { describe, expect, it } from 'vitest';
import glacial from '../../maps/glacial_source.json';
import hydro from '../../maps/hydro_dam.json';
import delta from '../../maps/delta_rapids.json';
import lumber from '../../maps/lumber_flume.json';
import meander from '../../maps/meander_to_waterfall.json';
import { applySWEEventFallback, eventsActiveAtHour, parseHydroEvents, hydroVortexSegments } from './hydroEvents';
import {
  CONTRAST_FLOW_SPEED,
  HYDRO_CONTRAST_MARGINS,
  hourEventCalls,
  hydroSegmentIndices,
  measureHydroHourContrast,
  measureHydroHourContrastWith,
  simulateHourGrid,
  type HydroEventApplier,
} from './hydroContrast';
import { sampleSWEFlow } from './sampleSWEFlow';
import { shouldApplyAuthoredVortexImpulse } from '../../physics/waterForceAuthority';
import { buildForecastSamples, FLOW_FORECAST_STATES } from '../map/flowForecast';
import { DAM_RELEASE_SCHEDULE } from '../../experience/constants';

const SCOUT_HOUR = 6;
const DAM_HOUR = 14;

/** Shipped maps the #397 gate covers — meander is the default ACTIVE_MAP_ID. */
const GATED_MAPS = [
  { id: 'glacial', events: parseHydroEvents(glacial.hydroEvents) },
  { id: 'meander', events: parseHydroEvents(meander.hydroEvents) },
  { id: 'hydro', events: parseHydroEvents(hydro.hydroEvents) },
  { id: 'delta', events: parseHydroEvents(delta.hydroEvents) },
];

describe('hydroContrast — 06:00 vs 14:00 on the shipped maps', () => {
  it.each(GATED_MAPS)('$id changes both mesh and hull', ({ events }) => {
    const segments = hydroSegmentIndices(events);
    expect(segments.length).toBeGreaterThan(0);

    const contrasts = segments.map((segmentIndex) =>
      measureHydroHourContrast(events, segmentIndex, SCOUT_HOUR, DAM_HOUR),
    );

    // Every authored segment has a different cast at the two hours…
    for (const contrast of contrasts) {
      expect(contrast.idsA).not.toEqual(contrast.idsB);
      expect(contrast.hullDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minHullDelta);
    }

    // …and the water mesh moves somewhere on the map, in η or in bed.
    const meshMoved = contrasts.some(
      (c) =>
        c.maxEtaDelta > HYDRO_CONTRAST_MARGINS.minEtaDelta ||
        c.maxBedDelta > HYDRO_CONTRAST_MARGINS.minBedDelta,
    );
    expect(meshMoved).toBe(true);
  });

  // Two different non-empty casts, not "something at 14:00 vs nothing at dawn":
  // the scout hour has to show its own water, not just the absence of a pulse.
  it.each(GATED_MAPS)('$id authors an event at both the scout hour and the dam hour', ({ events }) => {
    expect(eventsActiveAtHour(events, SCOUT_HOUR).length).toBeGreaterThan(0);
    expect(eventsActiveAtHour(events, DAM_HOUR).length).toBeGreaterThan(0);
  });

  it('meander: the pond dawn roughness alone changes the hull on seg 16', () => {
    const events = parseHydroEvents(meander.hydroEvents);
    const dawn = events.filter((e) => e.segmentIndex === 16 && eventsActiveAtHour([e], SCOUT_HOUR).length);
    expect(dawn.map((e) => e.kind)).toEqual(['roughness']);
    const contrast = measureHydroHourContrast(dawn, 16, SCOUT_HOUR, DAM_HOUR);
    expect(contrast.idsA).not.toEqual(contrast.idsB);
    expect(contrast.hullDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minHullDelta);
  });

  it('the hydro dam pulse raises stage and rides faster at 14:00', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const contrast = measureHydroHourContrast(events, 4, SCOUT_HOUR, DAM_HOUR);
    expect(contrast.hullStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(contrast.hullSpeedDelta).toBeGreaterThan(0);
  });

  it('meander: the waterfall pulse raises stage and the pond braid moves the bed at 14:00', () => {
    const events = parseHydroEvents(meander.hydroEvents);
    const fall = measureHydroHourContrast(events, 14, SCOUT_HOUR, DAM_HOUR);
    expect(fall.hullStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(fall.maxEtaDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);

    const pond = measureHydroHourContrast(events, 16, SCOUT_HOUR, DAM_HOUR);
    expect(pond.maxBedDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minBedDelta);
    expect(pond.hullDirDelta).toBeGreaterThan(0);
  });

  it('a braid moves the bed and pushes the hull laterally', () => {
    const events = parseHydroEvents(delta.hydroEvents);
    const contrast = measureHydroHourContrast(events, 9, SCOUT_HOUR, DAM_HOUR);
    expect(contrast.maxBedDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minBedDelta);
    expect(contrast.hullDirDelta).toBeGreaterThan(0);
  });
});

describe('hydro vortex authority', () => {
  it('a live hydroEvent vortex owns its segment; VortexForceSystem stands down', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const live = hydroVortexSegments(events, DAM_HOUR);
    expect([...live]).toEqual([5]);
    expect(shouldApplyAuthoredVortexImpulse(5, live)).toBe(false);
    expect(shouldApplyAuthoredVortexImpulse(4, live)).toBe(true);
  });

  it('outside the release window the authored vortex impulse is the fallback swirl', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const live = hydroVortexSegments(events, SCOUT_HOUR);
    expect(live.size).toBe(0);
    expect(shouldApplyAuthoredVortexImpulse(5, live)).toBe(true);
  });
});

describe('lumber braid couples to washedOutGap', () => {
  it('the gap washout shoal is only authored on hours the gap actually opens', () => {
    const samples = buildForecastSamples({
      temperature: 8,
      snowpackIndex: 0.65,
      damReleaseSchedule: DAM_RELEASE_SCHEDULE,
      startHour: 0,
      horizonHours: 24,
    });
    const washedOutHours = new Set(
      samples.filter((s) => s.state === FLOW_FORECAST_STATES.WASHED_OUT).map((s) => s.hour % 24),
    );
    expect(washedOutHours.size).toBeGreaterThan(0);

    const braid = parseHydroEvents(lumber.hydroEvents).find((e) => e.kind === 'braid');
    expect(braid).toBeDefined();
    for (const hour of braid!.hours ?? []) {
      expect(washedOutHours.has(hour)).toBe(true);
    }
  });
});

describe('glacial slush roughness damps the hull', () => {
  const SLUSH_SEGMENT = 3;
  const SLUSH_HOUR = 13;
  /** No glacial event is authored here — the un-damped reference. */
  const CLEAR_HOUR = 20;

  function hullSpeedAt(hour: number): number {
    const grid = simulateHourGrid(parseHydroEvents(glacial.hydroEvents), hour, SLUSH_SEGMENT);
    return sampleSWEFlow({
      worldX: 0,
      worldZ: 0,
      flowSpeed: CONTRAST_FLOW_SPEED,
      grid: {
        h: grid.h,
        u: grid.u,
        w: grid.w,
        b: grid.b,
        width: grid.width,
        height: grid.height,
        cellSize: grid.cellSize,
        originX: grid.originX,
        originZ: grid.originZ,
      },
      enabled: true,
    }).speed;
  }

  it('slows u,w where the slush is authored, not just where it is drawn', () => {
    const slush = hullSpeedAt(SLUSH_HOUR);
    const clear = hullSpeedAt(CLEAR_HOUR);

    expect(clear).toBeGreaterThan(0);
    expect(slush).toBeLessThan(clear);
  });
});

describe('hydroContrast event appliers (#435)', () => {
  it('replays 30 steps of the hour’s active events, in authored order', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const segment = hydroSegmentIndices(events)[0];
    const calls = hourEventCalls(events, DAM_HOUR, segment);
    expect(calls.length % 30).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.dt === 1 / 60)).toBe(true);
  });

  it('measures the same contrast through an injected TS applier as the built-in path', async () => {
    const events = parseHydroEvents(delta.hydroEvents);
    const tsApply: HydroEventApplier = (grid, calls) => {
      for (const c of calls) applySWEEventFallback(grid, c.kind, c.cx, c.cz, c.radius, c.strength, c.dt);
    };
    for (const segment of hydroSegmentIndices(events)) {
      const direct = measureHydroHourContrast(events, segment, SCOUT_HOUR, DAM_HOUR);
      const injected = await measureHydroHourContrastWith(tsApply, events, segment, SCOUT_HOUR, DAM_HOUR);
      expect(injected).toEqual(direct);
    }
  });
});
