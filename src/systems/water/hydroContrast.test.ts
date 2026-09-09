import { describe, expect, it } from 'vitest';
import glacial from '../../maps/glacial_source.json';
import hydro from '../../maps/hydro_dam.json';
import delta from '../../maps/delta_rapids.json';
import lumber from '../../maps/lumber_flume.json';
import { parseHydroEvents, hydroVortexSegments } from './hydroEvents';
import {
  HYDRO_CONTRAST_MARGINS,
  hydroSegmentIndices,
  measureHydroHourContrast,
} from './hydroContrast';
import { shouldApplyAuthoredVortexImpulse } from '../../physics/waterForceAuthority';
import { buildForecastSamples, FLOW_FORECAST_STATES } from '../map/flowForecast';
import { DAM_RELEASE_SCHEDULE } from '../../experience/constants';

const SCOUT_HOUR = 6;
const DAM_HOUR = 14;

/** The three shipped maps the #397 gate covers. */
const GATED_MAPS = [
  { id: 'glacial', events: parseHydroEvents(glacial.hydroEvents) },
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

  it('the hydro dam pulse raises stage and rides faster at 14:00', () => {
    const events = parseHydroEvents(hydro.hydroEvents);
    const contrast = measureHydroHourContrast(events, 4, SCOUT_HOUR, DAM_HOUR);
    expect(contrast.hullStageDelta).toBeGreaterThan(HYDRO_CONTRAST_MARGINS.minEtaDelta);
    expect(contrast.hullSpeedDelta).toBeGreaterThan(0);
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
