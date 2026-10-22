import { describe, expect, it } from 'vitest';
import { createRiverRouter, headDischargeAtHour } from './riverRouter';
import type { WatershedNativeModule } from './wasmAbi';
import type { RoutingReach } from '../map/routingReach';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';

/** A routing module that records the head inflow of each routed step (no WASM). */
function recordingModule() {
  const heap = new Float32Array(4096);
  let next = 16;
  const inflows: number[] = [];
  const wasm = {
    HEAPF32: heap,
    allocateGrid: (n: number) => {
      const ptr = next * 4;
      next += n;
      return ptr;
    },
    freeGrid: () => undefined,
    routeReachSteady: () => undefined,
    routeReachTravelTime: () => undefined,
    routedEdgeState: () => ({ eta: 0, speed: 0 }),
    routeReach: (_l: number, _s: number, _w: number, _n: number, inflowQ: number) => {
      inflows.push(inflowQ);
    },
  } as unknown as WatershedNativeModule;
  return { wasm, inflows };
}

const REACH: RoutingReach = {
  mapIds: ['glacial'],
  segments: [
    { mapId: 'glacial', index: 0 },
    { mapId: 'glacial', index: 1 },
    { mapId: 'glacial', index: 2 },
  ],
  lengths: Float32Array.of(100, 100, 100),
  slopes: Float32Array.of(0.03, 0.03, 0.03),
  widths: Float32Array.of(10, 10, 10),
};

describe('RiverRouter.setWeather', () => {
  it('routes the launch weather until told otherwise, then the director weather per step', () => {
    const { wasm, inflows } = recordingModule();
    const forecast = { ...DEFAULT_FORECAST_INPUTS, weather: { type: 'clear' as const, intensity: 0 } };
    const router = createRiverRouter(wasm, REACH, 10, { forecast, spinUpHours: 0 })!;
    expect(router).not.toBeNull();
    inflows.length = 0;

    router.advance(1);
    const clearQ = inflows[0];
    expect(clearQ).toBeCloseTo(headDischargeAtHour(10 + 0.5 / 3600, forecast), 4);

    router.setWeather({ type: 'storm', intensity: 0.9, overChainIndex: null });
    router.advance(1);
    const stormQ = inflows[1];
    expect(stormQ).toBeCloseTo(
      headDischargeAtHour(10 + 1.5 / 3600, { ...forecast, weather: { type: 'storm', intensity: 0.9 } }),
      4,
    );
    expect(stormQ).toBeGreaterThan(clearQ + 5);

    router.setWeather({ type: 'clear', intensity: 0, overChainIndex: null });
    router.advance(1);
    expect(inflows[2]).toBeCloseTo(clearQ, 2);
    router.dispose();
  });

  it('does not let a later setWeather mutate the caller forecast', () => {
    const { wasm } = recordingModule();
    const weather = { type: 'rain' as const, intensity: 0.7 };
    const router = createRiverRouter(wasm, REACH, 8, { forecast: { ...DEFAULT_FORECAST_INPUTS, weather }, spinUpHours: 0 })!;
    router.setWeather({ type: 'storm', intensity: 0.9, overChainIndex: null });
    expect(weather).toEqual({ type: 'rain', intensity: 0.7 });
    router.dispose();
  });
});
