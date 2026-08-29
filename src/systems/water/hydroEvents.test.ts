import { describe, expect, it } from 'vitest';
import { sampleSWEFlow } from './sampleSWEFlow';
import {
  applySWEEventFallback,
  eventsActiveAtHour,
  hashHydroEvents,
  hydroKindToInt,
  parseHydroEvents,
  type HydroEvent,
  type SWEEventGrid,
  HYDRO_KIND_INFLOW,
} from './hydroEvents';

function makeGrid(fillH = 0, fillB = 0): SWEEventGrid {
  const width = 8;
  const height = 8;
  const n = width * height;
  return {
    h: new Float32Array(n).fill(fillH),
    u: new Float32Array(n),
    w: new Float32Array(n),
    b: new Float32Array(n).fill(fillB),
    width,
    height,
    cellSize: 1,
    originX: 0,
    originZ: 0,
    stillDepth: 1.2,
  };
}

const PULSE: HydroEvent = {
  id: 'hydro-dam-pulse',
  kind: 'inflowPulse',
  segmentIndex: 4,
  hours: [14],
  radius: 6,
  strength: 4,
};

describe('hydroEvents', () => {
  it('activates pulse at 14:00 and not at the 06:00 control hour', () => {
    expect(eventsActiveAtHour([PULSE], 14).map((e) => e.id)).toEqual(['hydro-dam-pulse']);
    expect(eventsActiveAtHour([PULSE], 6)).toEqual([]);
  });

  it('hashes differ between control hour and pulse hour', () => {
    expect(hashHydroEvents([PULSE], 6)).not.toBe(hashHydroEvents([PULSE], 14));
  });

  it('parseHydroEvents drops malformed entries', () => {
    const parsed = parseHydroEvents([
      PULSE,
      { id: 'bad' },
      { id: 'ok', kind: 'braid', segmentIndex: 9, radius: 12, strength: 1.5, hours: [14, 15] },
    ]);
    expect(parsed.map((e) => e.id)).toEqual(['hydro-dam-pulse', 'ok']);
  });

  it('inflow vs control changes eta and the sampled hull speed', () => {
    const control = makeGrid();
    const pulse = makeGrid();
    applySWEEventFallback(pulse, HYDRO_KIND_INFLOW, 3.5, 3.5, 4, 8, 0.05);
    pulse.u.fill(0.4);
    pulse.w.fill(-1.2);

    const controlFlow = sampleSWEFlow({
      worldX: 3.5,
      worldZ: 3.5,
      flowSpeed: 2,
      grid: {
        h: control.h,
        u: control.u,
        w: control.w,
        b: control.b,
        width: control.width,
        height: control.height,
        cellSize: control.cellSize,
        originX: control.originX,
        originZ: control.originZ,
      },
      enabled: true,
    });
    const pulseFlow = sampleSWEFlow({
      worldX: 3.5,
      worldZ: 3.5,
      flowSpeed: 2,
      grid: {
        h: pulse.h,
        u: pulse.u,
        w: pulse.w,
        b: pulse.b,
        width: pulse.width,
        height: pulse.height,
        cellSize: pulse.cellSize,
        originX: pulse.originX,
        originZ: pulse.originZ,
      },
      enabled: true,
    });

    expect(pulse.h[3 + 3 * 8]).toBeGreaterThan(control.h[3 + 3 * 8]);
    expect(pulseFlow.speed).toBeGreaterThan(controlFlow.speed);
    expect(hydroKindToInt('vortex')).toBe(1);
  });
});
