/**
 * SimCore.ts — the one fixed-step gameplay clock (#521 A).
 *
 * A plain module: no React, no three objects in its state. It owns a 1/60 s
 * accumulator and an ordered registry of systems `{ id, order, step(ctx, dt) }`.
 * Two things advance it, and they run the very same `step()`:
 *
 *   - a real frame: `<SimCoreTick />` (experience/) calls `advance(frameDelta)`
 *     once per R3F frame at useFrame priority −90, right after the input hub
 *     (−100). The accumulator turns the variable frame delta into 0..N fixed
 *     steps, clamped to `SIM_MAX_SUBSTEPS` so a stalled tab cannot spiral.
 *   - a scripted / replay frame: `stepScripted(n)` (input/scriptedRun.ts) puts
 *     the core in scripted mode for its run; `advance()` then takes exactly one
 *     step per call whatever the delta says, so n frames are n steps and no
 *     float residue in a delta can ever add or drop one.
 *
 * Within one step the systems run in `order` (ties: registration order), each
 * with the same context and the same `SIM_DT`. Gameplay state that used to be
 * advanced by an assorted useFrame, a React effect or a timer is advanced by a
 * system here, so a headless run, a replay and a real frame execute identical
 * code.
 *
 * Order bands (leave gaps; a new system picks the band, not a number in use):
 *   10 weather · 20 sky clock · 30 chunk/biome · 40 survival · 50 pillars ·
 *   60 gameplay profile (#521 B) · 90 scoring / splits / ghost.
 */

import { createRng, type Rng } from '../../math/random';
import { createInputFrame, type InputFrame } from '../../input/InputFrame';
import type { SegmentFrame } from '../../systems/map/segmentFrames';

/** The fixed sim step, seconds. Matches `INPUT_FIXED_DT_MS`. */
export const SIM_DT = 1 / 60;

/** A frame never runs more than this many steps; the rest of its backlog is dropped. */
export const SIM_MAX_SUBSTEPS = 5;

/**
 * Seed of the run stream. The splash foam gate drew from `createRng(0x5f0a3e71)`
 * before it moved here, so a fresh page draws the same numbers it always did —
 * and now every restart draws them again from the top.
 */
export const SIM_RNG_SEED = 0x5f0a3e71;

/** A frame delta this close under a step still makes one (float residue, never more than a µs). */
const STEP_EPSILON = 1e-6;

/** What the sim samples of the vehicle at the top of a step. Numbers only. */
export interface SimVehicleProbe {
  /** A body exists and its horizontal velocity was finite (the scoring gate). */
  valid: boolean;
  /** The body's translation was finite (the ghost gate). */
  posOk: boolean;
  isRaft: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Pose orientation for the ghost: the camera's for the runner, the body's for the raft. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface SimContext {
  /** The run's stream (reseeded on every run reset). Stable identity; draws are deterministic. */
  readonly rng: Rng;
  /** Sim seconds since the last reset, including the step being run. */
  time: number;
  /** Steps run since the last reset (0 before the first). */
  stepIndex: number;
  /** The hub's frame for this render frame (the same object every time). */
  input: Readonly<InputFrame>;
  /** The segment frame under the camera, or null with no live frames. */
  segment: SegmentFrame | null;
  /** `GameState.currentSegmentIndex` as of the tick. */
  segmentIndex: number;
  paused: boolean;
  camera: { z: number; sane: boolean };
  vehicle: SimVehicleProbe;
}

export interface SimSystem {
  id: string;
  order: number;
  step(ctx: SimContext, dt: number): void;
  /** Run reset (a new run on this page): drop whatever the last run left in the system. */
  reset?(ctx: SimContext): void;
}

function createVehicleProbe(): SimVehicleProbe {
  return {
    valid: false,
    posOk: false,
    isRaft: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

export class SimCore {
  readonly ctx: SimContext;
  private systems: SimSystem[] = [];
  private accumulator = 0;
  private scripted = false;
  private seed = SIM_RNG_SEED;
  private stream: Rng;

  constructor() {
    this.stream = createRng(this.seed);
    this.ctx = {
      rng: () => this.stream(),
      time: 0,
      stepIndex: 0,
      input: createInputFrame(),
      segment: null,
      segmentIndex: 0,
      paused: false,
      camera: { z: 0, sane: false },
      vehicle: createVehicleProbe(),
    };
  }

  /** Add a system; returns its unregister function. Ids are unique. */
  register(system: SimSystem): () => void {
    if (this.systems.some((s) => s.id === system.id)) {
      throw new Error(`[SimCore] system "${system.id}" is already registered`);
    }
    // Stable insert: after every system with an order <= this one's.
    let at = this.systems.length;
    while (at > 0 && this.systems[at - 1].order > system.order) at -= 1;
    this.systems.splice(at, 0, system);
    return () => this.unregister(system.id);
  }

  unregister(id: string): void {
    const at = this.systems.findIndex((s) => s.id === id);
    if (at >= 0) this.systems.splice(at, 1);
  }

  /** Registered ids in the order they step. */
  getSystemIds(): string[] {
    return this.systems.map((s) => s.id);
  }

  /** Scripted mode: one `advance()` is exactly one step. Set by `stepScripted` for its run. */
  setScripted(on: boolean): void {
    this.scripted = on;
  }

  isScripted(): boolean {
    return this.scripted;
  }

  /**
   * Feed one render frame's delta (seconds). Returns the steps it ran.
   * Frame path: accumulate, run whole steps, drop a backlog past the clamp.
   */
  advance(frameDeltaSec: number): number {
    if (this.scripted) {
      this.step();
      return 1;
    }
    if (!(frameDeltaSec > 0)) return 0;
    this.accumulator += frameDeltaSec;
    let steps = 0;
    while (this.accumulator >= SIM_DT - STEP_EPSILON && steps < SIM_MAX_SUBSTEPS) {
      this.accumulator -= SIM_DT;
      this.step();
      steps += 1;
    }
    if (steps === SIM_MAX_SUBSTEPS) this.accumulator = 0;
    return steps;
  }

  /** One fixed step through every system. The only place a system's `step` is called. */
  step(): void {
    const { ctx, systems } = this;
    ctx.time += SIM_DT;
    ctx.stepIndex += 1;
    for (let i = 0; i < systems.length; i += 1) systems[i].step(ctx, SIM_DT);
  }

  /** Start of a run: clock to zero, the stream back to its seed, every system told. */
  reset(seed: number = SIM_RNG_SEED): void {
    this.seed = seed;
    this.stream = createRng(seed);
    this.accumulator = 0;
    this.ctx.time = 0;
    this.ctx.stepIndex = 0;
    for (let i = 0; i < this.systems.length; i += 1) this.systems[i].reset?.(this.ctx);
  }

  getSeed(): number {
    return this.seed;
  }

  /** Back to a just-constructed core (tests). Registered systems are dropped. */
  resetForTests(): void {
    this.systems = [];
    this.scripted = false;
    this.reset(SIM_RNG_SEED);
    this.ctx.paused = false;
    this.ctx.segment = null;
    this.ctx.segmentIndex = 0;
    this.ctx.camera.z = 0;
    this.ctx.camera.sane = false;
    Object.assign(this.ctx.vehicle, createVehicleProbe());
  }
}

/** The page's core. */
export const simCore = new SimCore();
