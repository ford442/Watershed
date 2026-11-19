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
import { ROUTING_SUBREACHES, allocateGrids, heapF32, type CubicMetresPerSecond, type F32, type Metres, type MetresPerSecondSquared, type Ptr, type RoutedEdge, type Seconds, type WatershedNativeModule } from './wasmAbi';

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
   * The weather at launch (#464): the spin-up routes it, and it stays in force
   * until `RiverRouter.setWeather` says otherwise. Rain and storm add head
   * discharge, so the storm reaches the window's edge with the routed lag;
   * absent or clear routes exactly as before.
   */
  weather?: RunWeather | null;
}

/**
 * A hazard's release joining the chain (#578 A): an open dam's gates add
 * `discharge` (m³/s) at the top of chain segment `chainIndex`, routed down the
 * chain like the weather's runoff. Reach `chainIndex` carries it at once, the
 * reaches below with the routed lag, the reaches above never.
 */
export interface RouterRelease {
  discharge: number;
  chainIndex: number;
}

/** The WeatherDirector's river weather as one routed step reads it. */
export interface RouterWeather {
  type: RunWeather['type'];
  intensity: number;
  /** Chain segment the weather sits over; null = the head. */
  overChainIndex: number | null;
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
  advance(dt: Seconds): void;
  /**
   * Discharge entering chain segment `k` (m³/s): the head inflow, or segment
   * k−1's outflow, plus any weather runoff joining at k this step.
   */
  dischargeInto(k: number): CubicMetresPerSecond;
  /** Upstream-edge state for a window in chain segment `k`, relative to ROUTING_NOMINAL_DISCHARGE. */
  edgeState(k: number, H: Metres, g: MetresPerSecondSquared): RoutedEdge;
  /** Kinematic travel time (s) from the head to segment `k`'s outflow at the nominal discharge. */
  lag(k: number): Seconds;
  /** The weather the next `advance` routes (the director's, once per step). */
  setWeather(weather: RouterWeather | null): void;
  /**
   * The hazard release the next `advance` routes (#578 A), or null for none.
   * Needs the ABI-14 lateral export; without it a release adds nothing.
   */
  setRelease(release: RouterRelease | null): void;
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

  const forecast: RoutingForecast = options.forecast ?? DEFAULT_FORECAST_INPUTS;
  const spinUpHours = options.spinUpHours ?? ROUTING_SPINUP_HOURS;
  const spinUpDt: Seconds = options.spinUpDt ?? ROUTING_SPINUP_DT;

  // `lateral`: discharge joining each segment at its top, the weather over a reach (ABI 14).
  const [lengths, slopes, widths, storage, outflow, lag, lateral] =
    allocateGrids(wasm, [n, n, n, n * ROUTING_SUBREACHES, n, n, n]);
  const ptrs = { lengths, slopes, widths, storage, outflow, lag, lateral };
  // Made once: the heap is fixed-size, so these stay valid until dispose.
  const view = (ptr: Ptr<F32>) => heapF32(wasm, ptr, n);
  view(ptrs.lengths).set(reach.lengths);
  view(ptrs.slopes).set(reach.slopes);
  view(ptrs.widths).set(reach.widths);
  const lateralView = view(ptrs.lateral);
  const outflowView = view(ptrs.outflow);
  const lagView = view(ptrs.lag);

  // Branded (#575): routeReach takes (…, inflowQ: m³/s, dt: s, …), so passing
  // these two the other way round is a tsc error, not a silently wrong river.
  const route = (inflowQ: CubicMetresPerSecond, dt: Seconds) =>
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
  // The weather the steps route: the launch weather until the director says otherwise.
  const live: RoutingForecast = { ...forecast, weather: forecast.weather ? { ...forecast.weather } : null };
  // The same day without weather: the head's own hydrograph when the weather sits over a reach.
  const dry: RoutingForecast = { ...forecast, weather: null };
  /** Chain segment the weather sits over (lateral inflow), or null for the head. */
  let liveOver: number | null = null;
  let headQ: CubicMetresPerSecond = headDischargeAtHour(launchHour, live);
  // What joins the chain this step, kept as doubles: `dischargeInto` adds these,
  // never the float32 plane, so a weather-only day routes exactly as before.
  /** Weather runoff joining `lateralAt` this step (m³/s). */
  let lateralQ: CubicMetresPerSecond = 0;
  let lateralAt = -1;
  /** A hazard release joining `releaseAt` this step (m³/s, #578 A). */
  let releaseQ: CubicMetresPerSecond = 0;
  let releaseAt = -1;
  /** The release the next advance routes (set between steps). */
  let pendingRelease: RouterRelease | null = null;
  let disposed = false;
  const clampK = (k: number) => Math.max(0, Math.min(n - 1, Math.trunc(k)));
  const clearLateral = () => {
    if (lateralAt >= 0) lateralView[lateralAt] = 0;
    if (releaseAt >= 0) lateralView[releaseAt] = 0;
    lateralAt = -1;
    lateralQ = 0;
    releaseAt = -1;
    releaseQ = 0;
  };
  const routeLateral = typeof wasm.routeReachLateral === 'function' ? wasm.routeReachLateral.bind(wasm) : null;

  return {
    reach,
    launchHour,
    get elapsed() {
      return elapsed;
    },
    advance(dt) {
      if (disposed || !(dt > 0) || !Number.isFinite(dt)) return;
      const hour = launchHour + (elapsed + 0.5 * dt) / 3600;
      const release =
        routeLateral && pendingRelease && pendingRelease.discharge > 0 && Number.isFinite(pendingRelease.discharge)
          ? pendingRelease
          : null;
      const weatherOver = liveOver !== null && routeLateral !== null;
      if (routeLateral && (weatherOver || release)) {
        // Rain over reach k: the head carries the day's own hydrograph and the
        // weather's runoff joins at k — reach k hears it now, the reaches below
        // with the routed lag, the reaches above never. A dam's release joins
        // its own reach the same way.
        headQ = headDischargeAtHour(hour, weatherOver ? dry : live);
        clearLateral();
        if (weatherOver) {
          lateralAt = clampK(liveOver!);
          lateralQ = weatherFlowRateDelta(hour, live.weather) * ROUTING_NOMINAL_DISCHARGE;
          lateralView[lateralAt] = lateralQ;
        }
        if (release) {
          releaseAt = clampK(release.chainIndex);
          releaseQ = release.discharge;
          lateralView[releaseAt] += releaseQ;
        }
        routeLateral(ptrs.lengths, ptrs.slopes, ptrs.widths, n, headQ, ptrs.lateral, dt, ptrs.storage, ptrs.outflow);
      } else {
        headQ = headDischargeAtHour(hour, live);
        clearLateral();
        route(headQ, dt);
      }
      elapsed += dt;
    },
    dischargeInto(k) {
      if (disposed) return ROUTING_NOMINAL_DISCHARGE;
      const kk = clampK(k);
      const above = kk === 0 ? headQ : outflowView[kk - 1];
      const withWeather = kk === lateralAt ? above + lateralQ : above;
      return kk === releaseAt ? withWeather + releaseQ : withWeather;
    },
    edgeState(k, H, g) {
      if (disposed) return { eta: 0, speed: 0 };
      return wasm.routedEdgeState(this.dischargeInto(k), ROUTING_NOMINAL_DISCHARGE, H, g);
    },
    lag(k) {
      return disposed ? 0 : lagView[clampK(k)];
    },
    setWeather(weather) {
      if (!weather) {
        live.weather = null;
        liveOver = null;
        return;
      }
      if (!live.weather) live.weather = { type: weather.type, intensity: weather.intensity };
      else {
        live.weather.type = weather.type;
        live.weather.intensity = weather.intensity;
      }
      liveOver = weather.overChainIndex;
    },
    setRelease(release) {
      if (!release) {
        pendingRelease = null;
        return;
      }
      if (!pendingRelease) pendingRelease = { discharge: release.discharge, chainIndex: release.chainIndex };
      else {
        pendingRelease.discharge = release.discharge;
        pendingRelease.chainIndex = release.chainIndex;
      }
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
