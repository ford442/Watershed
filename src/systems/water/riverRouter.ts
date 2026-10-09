/**
 * riverRouter — the launch-hour discharge, routed down the campaign chain, as
 * the stage at the SWE window's upstream edge.
 *
 * Before this, the forecast only reached the solver as authored `hydroEvents`
 * disks: a 14:00 dam pulse was a source painted on one segment. Now the hour's
 * `flowRate` (flowForecast.computeFlowRate, the same sample the treadmill and
 * the launch picker read) is a discharge at the head of the chain, carried
 * downstream with a travel time by emscripten/routing.cpp, and the routed
 * discharge at the player's segment sets the window's upstream edge
 * (`SweStepInput.edgeEta` → stepShallowWaterInflow / swe.wgsl).
 *
 * This module is plumbing only: heap arrays, the hydrograph sample, and the
 * clock. The routing step and the stage rating live in C++ — never in TS.
 *
 * Time: the router runs in real seconds from launch. It is spun up over the
 * hours before launch so the river the player meets already carries what left
 * the head earlier (a 13:00 release has reached the hydro basin by 14:00).
 */
import { computeFlowRate } from '../map/flowForecast';
import { weatherFlowRateDelta, type RunWeather } from '../map/weatherInflow';
import type { RoutingReach } from '../map/routingReach';
import { DEFAULT_FORECAST_INPUTS } from '../../constants/forecast';
import type { SweInflow } from './sweScroll';
import {
  ROUTING_SUBREACHES,
  type RoutedEdge,
  type WatershedNativeModule,
} from './WatershedWasm';

/**
 * Head discharge at `flowRate` 1 (m³/s). It is also the reference discharge
 * the SWE window's still water stands for: a flowRate-1 hour is exactly rest at
 * the edge (routedEdgeState(Qref, Qref) = 0).
 */
export const ROUTING_NOMINAL_DISCHARGE = 40;
/**
 * Hours of hydrograph routed before launch. The whole chain's travel time is
 * ~21 min at the nominal discharge, so two hours flush it several times: the
 * river at launch carries what the head released over the preceding hours.
 * (hydroContrast.test pins lag(last) well under this.)
 */
export const ROUTING_SPINUP_HOURS = 2;
/** Spin-up step (s). The C++ integrates each reservoir exactly, so this is accuracy, not stability. */
export const ROUTING_SPINUP_DT = 5;

export interface RoutingForecast {
  temperature: number;
  snowpackIndex: number;
  damReleaseSchedule: ReadonlyArray<{ hour: number; release: number }>;
  /**
   * The run's weather (#464). Rain and storm add head discharge, so the storm
   * reaches the window's edge with the routed lag; absent or clear routes
   * exactly as before.
   */
  weather?: RunWeather | null;
}

function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

/** The head hydrograph: the forecast `flowRate` (plus any rain / storm runoff) at `hour` as a discharge (m³/s). */
export function headDischargeAtHour(
  hour: number,
  forecast: RoutingForecast = DEFAULT_FORECAST_INPUTS,
): number {
  const h = wrapHour(hour);
  const flowRate = computeFlowRate(h, forecast.temperature, forecast.snowpackIndex, forecast.damReleaseSchedule);
  // Clear weather adds exactly 0, so a clear day routes bit-identically to pre-weather.
  return (flowRate + weatherFlowRateDelta(h, forecast.weather)) * ROUTING_NOMINAL_DISCHARGE;
}

type RoutingModule = WatershedNativeModule &
  Required<Pick<WatershedNativeModule, 'routeReach' | 'routeReachSteady' | 'routeReachTravelTime' | 'routedEdgeState'>>;

/** True when the binary carries the ABI-10 routing exports. */
export function hasRouting(wasm: WatershedNativeModule): wasm is RoutingModule {
  return (
    typeof wasm.routeReach === 'function' &&
    typeof wasm.routeReachSteady === 'function' &&
    typeof wasm.routeReachTravelTime === 'function' &&
    typeof wasm.routedEdgeState === 'function'
  );
}

export interface RiverRouter {
  readonly reach: RoutingReach;
  readonly launchHour: number;
  /** Seconds routed since launch. */
  readonly elapsed: number;
  /** Advance the chain by `dt` seconds of run time. */
  advance(dt: number): void;
  /** Discharge entering chain segment `k` (m³/s): the head inflow, or segment k−1's outflow. */
  dischargeInto(k: number): number;
  /** Upstream-edge state for a window in chain segment `k`, relative to ROUTING_NOMINAL_DISCHARGE. */
  edgeState(k: number, H: number, g: number): RoutedEdge;
  /** Kinematic travel time (s) from the head to segment `k`'s outflow at the nominal discharge. */
  lag(k: number): number;
  dispose(): void;
}

export interface RiverRouterOptions {
  forecast?: RoutingForecast;
  spinUpHours?: number;
  spinUpDt?: number;
}

/**
 * Allocate the chain on the WASM heap and spin it up to `launchHour`.
 * Null when the binary predates the routing exports (ABI < 10).
 */
export function createRiverRouter(
  wasm: WatershedNativeModule,
  reach: RoutingReach,
  launchHour: number,
  options: RiverRouterOptions = {},
): RiverRouter | null {
  if (!hasRouting(wasm)) return null;
  const n = reach.segments.length;
  if (n === 0) return null;

  const forecast = options.forecast ?? DEFAULT_FORECAST_INPUTS;
  const spinUpHours = options.spinUpHours ?? ROUTING_SPINUP_HOURS;
  const spinUpDt = options.spinUpDt ?? ROUTING_SPINUP_DT;

  const ptrs = {
    lengths: wasm.allocateGrid(n),
    slopes: wasm.allocateGrid(n),
    widths: wasm.allocateGrid(n),
    storage: wasm.allocateGrid(n * ROUTING_SUBREACHES),
    outflow: wasm.allocateGrid(n),
    lag: wasm.allocateGrid(n),
  };
  // Views are re-derived on each read: memory growth detaches HEAPF32.
  const view = (ptr: number) => wasm.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + n);
  view(ptrs.lengths).set(reach.lengths);
  view(ptrs.slopes).set(reach.slopes);
  view(ptrs.widths).set(reach.widths);

  const route = (inflowQ: number, dt: number) =>
    wasm.routeReach(ptrs.lengths, ptrs.slopes, ptrs.widths, n, inflowQ, dt, ptrs.storage, ptrs.outflow);

  // Spin-up: steady at the first hour, then the real hydrograph up to launch.
  const start = launchHour - spinUpHours;
  wasm.routeReachSteady(ptrs.lengths, ptrs.slopes, ptrs.widths, n, headDischargeAtHour(start, forecast), ptrs.storage, ptrs.outflow);
  const spinSteps = Math.round((spinUpHours * 3600) / spinUpDt);
  for (let s = 0; s < spinSteps; s += 1) {
    route(headDischargeAtHour(start + ((s + 0.5) * spinUpDt) / 3600, forecast), spinUpDt);
  }
  wasm.routeReachTravelTime(ptrs.lengths, ptrs.slopes, ptrs.widths, n, ROUTING_NOMINAL_DISCHARGE, ptrs.lag);

  let elapsed = 0;
  let headQ = headDischargeAtHour(launchHour, forecast);
  let disposed = false;
  const clampK = (k: number) => Math.max(0, Math.min(n - 1, Math.trunc(k)));

  return {
    reach,
    launchHour,
    get elapsed() {
      return elapsed;
    },
    advance(dt) {
      if (disposed || !(dt > 0)) return;
      headQ = headDischargeAtHour(launchHour + (elapsed + 0.5 * dt) / 3600, forecast);
      route(headQ, dt);
      elapsed += dt;
    },
    dischargeInto(k) {
      if (disposed) return ROUTING_NOMINAL_DISCHARGE;
      const kk = clampK(k);
      return kk === 0 ? headQ : view(ptrs.outflow)[kk - 1];
    },
    edgeState(k, H, g) {
      if (disposed) return { eta: 0, speed: 0 };
      return wasm.routedEdgeState(this.dischargeInto(k), ROUTING_NOMINAL_DISCHARGE, H, g);
    },
    lag(k) {
      return disposed ? 0 : view(ptrs.lag)[clampK(k)];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const ptr of Object.values(ptrs)) wasm.freeGrid(ptr);
    },
  };
}

/**
 * Routed state at chain segment `k` as the SWE window uses it: the upstream
 * edge stage, and the (η, u, w) an entering cell takes. Null without a router
 * or off the chain. Shared by the main-thread frame (wasm-main / wgsl) and the
 * sim worker (wasm-worker), so both derive the edge with the same code.
 */
export function routedEdgeInflow(
  router: RiverRouter | null,
  k: number | null,
  H: number,
  g: number,
): { edgeEta: number; inflow: SweInflow } | null {
  if (!router || k === null) return null;
  const edge = router.edgeState(k, H, g);
  // Downstream is −Z: the routed wave arrives moving toward −Z.
  return { edgeEta: edge.eta, inflow: { eta: edge.eta, u: 0, w: -edge.speed } };
}
