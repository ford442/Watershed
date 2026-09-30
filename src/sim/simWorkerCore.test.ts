/**
 * simWorkerCore — Phase B commands without a binary (#455). The stub module
 * records calls; bit parity against the real binary is the integration test.
 */
import { describe, expect, it, vi } from 'vitest';
import type { WatershedNativeModule } from '../systems/water/WatershedWasm';
import { createSimWorkerCore } from './simWorkerCore';
import type { SimWorkerResponse } from './simWorkerProtocol';

function stubModule() {
  const heap = new Float32Array(1 << 14);
  let next = 16;
  return {
    HEAPF32: heap,
    getVersion: () => 11,
    allocateGrid: (count: number) => {
      const ptr = next * 4;
      next += count;
      return ptr;
    },
    freeGrid: vi.fn(),
    stepShallowWater: vi.fn(),
    stepShallowWaterInflow: vi.fn(),
    applySWEEvent: vi.fn(),
    scrollShallowWater: vi.fn(),
    routeReachSteady: vi.fn(),
    routeReach: vi.fn(),
    routeReachTravelTime: vi.fn(),
    routedEdgeState: vi.fn(() => ({ eta: 0.07, speed: 0.5 })),
  } as unknown as WatershedNativeModule & Record<string, ReturnType<typeof vi.fn>>;
}

const REACH = {
  mapIds: ['glacial'],
  segments: [{ mapId: 'glacial', index: 0 }, { mapId: 'glacial', index: 1 }],
  lengths: Float32Array.of(100, 100),
  slopes: Float32Array.of(0.01, 0.01),
  widths: Float32Array.of(20, 20),
} as never;
const FORECAST = { temperature: 8, snowpackIndex: 0.65, damReleaseSchedule: [] };
const STEP = { dt: 1 / 60, g: 9.80665, H: 1, originX: 0, originZ: 0, events: [] };

function core() {
  const wasm = stubModule();
  const out: SimWorkerResponse[] = [];
  const c = createSimWorkerCore(wasm, (r) => out.push(r));
  c.handle({ type: 'CONFIGURE', gridId: 1, width: 8, height: 6, dx: 0.5 });
  return { wasm, out, c };
}

describe('simWorkerCore routing (Phase B)', () => {
  it('skips an unrouted fresh-window fill but still advances the epoch the mirror advanced', () => {
    const { wasm, out, c } = core();
    c.handle({
      type: 'SCROLL', gridId: 1, surface: [], shiftX: 8, shiftZ: 0,
      fill: { kind: 'routed', route: { chainIndex: null }, requireRouted: true },
    });
    c.handle({ type: 'STEP', gridId: 1, surface: [], input: STEP, route: { chainIndex: null } });
    expect(wasm.scrollShallowWater).not.toHaveBeenCalled();
    expect(wasm.stepShallowWater).toHaveBeenCalled(); // no edge: transmissive
    const frame = out.find((r) => r.type === 'FRAME');
    expect(frame?.type === 'FRAME' && frame.frame.epoch).toBe(1);
    expect(frame?.type === 'FRAME' && frame.frame.inflow).toBeNull();
  });

  it('fills and steps with the routed edge, evaluated before the router advances', () => {
    const { wasm, out, c } = core();
    c.handle({ type: 'ROUTER', reach: REACH, launchHour: 14, forecast: FORECAST, H: 1, g: 9.80665 });
    expect(wasm.routeReachSteady).toHaveBeenCalledTimes(1);
    const order: string[] = [];
    wasm.routedEdgeState.mockImplementation(() => {
      order.push('edge');
      return { eta: 0.07, speed: 0.5 };
    });
    wasm.routeReach.mockImplementation(() => order.push('advance'));
    wasm.stepShallowWaterInflow.mockImplementation(() => order.push('step'));
    const spinUp = wasm.routeReach.mock.calls.length;

    c.handle({
      type: 'SCROLL', gridId: 1, surface: [], shiftX: 8, shiftZ: 0,
      fill: { kind: 'routed', route: { chainIndex: 1 }, requireRouted: true }, origin: { x: 2, z: 3 },
    });
    c.handle({ type: 'STEP', gridId: 1, surface: [], input: STEP, route: { chainIndex: 1 } });

    expect(wasm.scrollShallowWater.mock.calls[0].slice(-3)).toEqual([0.07, 0, -0.5]);
    expect(wasm.stepShallowWaterInflow.mock.calls[0].at(-1)).toBe(0.07);
    expect(wasm.routeReach.mock.calls.length - spinUp).toBe(1);
    expect(order.slice(-3)).toEqual(['edge', 'advance', 'step']);
    const frame = out.find((r) => r.type === 'FRAME');
    expect(frame?.type === 'FRAME' && frame.frame.inflow).toEqual({ eta: 0.07, u: 0, w: -0.5 });
  });

  it('keeps the router across grids and frees it on DISPOSE_ROUTER', () => {
    const { wasm, c } = core();
    c.handle({ type: 'ROUTER', reach: REACH, launchHour: 6, forecast: FORECAST, H: 1, g: 9.80665 });
    c.handle({ type: 'CONFIGURE', gridId: 2, width: 8, height: 6, dx: 0.5 });
    c.handle({ type: 'STEP', gridId: 2, surface: [], input: STEP, route: { chainIndex: 0 } });
    expect(wasm.stepShallowWaterInflow).toHaveBeenCalled();
    const freed = wasm.freeGrid.mock.calls.length;
    c.handle({ type: 'DISPOSE_ROUTER' });
    expect(wasm.freeGrid.mock.calls.length - freed).toBe(6); // the router's six heap arrays
  });
});
