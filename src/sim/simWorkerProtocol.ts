/**
 * simWorkerProtocol — typed messages between the main thread and the sim
 * worker (#455). Same style as physics/rapierWorkerProtocol.ts.
 *
 * Phase A: the worker owns the SWE grid and its WASM instance. The main thread
 * still decides *when* to step and with what (dt, events), so the command
 * stream — and therefore the field — is the one `createWasmSweSim` would
 * compute on the main thread. Commands are applied strictly in order.
 *
 * Phase B: the worker also owns the river router (ROUTER; STEP / SCROLL name
 * the player's chain segment and the worker derives the routed edge and the
 * entering-cell inflow) and the water forces (FORCES from the main thread;
 * HULL over a MessagePort from the Rapier worker — hullLinkProtocol.ts).
 */
import type { SweEventCall, SweStepInput } from '../systems/water/sweSim';
import type { SweInflow } from '../systems/water/sweScroll';
import type { RoutingReach } from '../systems/map/routingReach';
import type { RoutingForecast } from '../systems/water/riverRouter';
import type { SimFrame } from './SimFrame';

/**
 * Queued `addSurface` calls as flat (index, amount) pairs, applied in order
 * before the command they ride on — the same order `applyDisturbances` adds
 * them on the main-thread path, so the sums round identically.
 */
export type SurfaceOps = number[];

export interface SimStepPayload extends Omit<SweStepInput, 'events'> {
  events: SweEventCall[];
}

/**
 * Routing for one STEP / SCROLL: the player's position on the routed chain
 * (`routingChainIndex`, null off the chain). The worker evaluates the edge
 * BEFORE advancing its router, exactly as the main-thread frame does.
 */
export interface SimRoute {
  chainIndex: number | null;
}

/** What cells entering on a SCROLL take. */
export type SimScrollFill =
  | { kind: 'inflow'; inflow: SweInflow }
  /**
   * The routed state at `chainIndex` (rest when unrouted). `requireRouted`: a
   * freshly placed window is only filled when a routed state exists — the
   * epoch still advances either way, so the mirror stays in step.
   */
  | { kind: 'routed'; route: SimRoute; requireRouted: boolean };

export type SimWorkerCommand =
  | {
      type: 'INIT';
      /**
       * Page-resolved, stamped URLs of the glue and the wasm (`resolvePublicAsset`).
       * The worker's own location is its script, not the page, so it cannot find
       * public/ by itself.
       */
      assets: { glue: string; wasm: string };
    }
  | { type: 'CONFIGURE'; gridId: number; width: number; height: number; dx: number }
  | { type: 'COMMIT_BED'; gridId: number; b: Float32Array }
  /** World XZ of cell (0, 0). Rides on SCROLL too, so a hull lookup never pairs the new index frame with the old origin. */
  | { type: 'ORIGIN'; gridId: number; originX: number; originZ: number }
  | {
      type: 'SCROLL';
      gridId: number;
      surface: SurfaceOps;
      shiftX: number;
      shiftZ: number;
      fill: SimScrollFill;
      origin?: { x: number; z: number };
    }
  | { type: 'STEP'; gridId: number; surface: SurfaceOps; input: SimStepPayload; route?: SimRoute }
  | { type: 'RETURN_FRAME'; buffer: ArrayBuffer }
  | { type: 'DISPOSE_GRID'; gridId: number }
  /**
   * (Re)build the session's router — a new run or launch hour. Independent of
   * the grid: a quality change keeps it, as on the main thread. `H` / `g` rate
   * the routed discharge as an edge stage.
   */
  | {
      type: 'ROUTER';
      reach: RoutingReach;
      launchHour: number;
      forecast: RoutingForecast;
      H: number;
      g: number;
    }
  | { type: 'DISPOSE_ROUTER' }
  /**
   * Water forces for `count` bodies (simForces.ts wire format), sampled on grid
   * `gridId` at this origin — or on no grid (the authored flow) when that grid
   * is not live. Posted after the frame's STEP, so it reads the stepped field.
   * `samples` is transferred and comes back holding the results.
   */
  | {
      type: 'FORCES';
      seq: number;
      gridId: number;
      originX: number;
      originZ: number;
      count: number;
      samples: Float64Array;
    }
  /** One end of the Rapier worker's hull link (hullLinkProtocol.ts). */
  | { type: 'CONNECT_PHYSICS'; port: MessagePort };

export interface SimForceResult {
  seq: number;
  count: number;
  /** `count * FORCE_RESULT_STRIDE` values — the request's buffer, reused. */
  results: Float64Array;
  /** Embind calls the batch took. */
  calls: number;
  computeMicros: number;
}

export type SimWorkerResponse =
  | { type: 'READY'; abi: number }
  | { type: 'FRAME'; frame: SimFrame }
  | ({ type: 'FORCES' } & SimForceResult)
  | { type: 'ERROR'; error: string; fatal: boolean };

export interface SimWorkerLike {
  postMessage(message: SimWorkerCommand, transfer?: Transferable[]): void;
  terminate?(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SimWorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<SimWorkerResponse>) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
}
