/**
 * raftSimSystem.ts — the raft's physics step as a SimCore system (#577 A.1).
 *
 * The raft stepped in `useRaftControls`' `useFrame` on R3F's frame delta, so
 * a headless run could not drive it and the delta finale had no harness. It is
 * `vehicle-raft` in SimCore's registry now, at the runner's slot (95: after
 * the Rapier world's step, 92, as the frame callback was): the same `SIM_DT`,
 * `ctx.input` and `ctx.game` as every other system. Only one vehicle is
 * mounted at a time, so `vehicle-runner` and `vehicle-raft` never both step.
 *
 * The host (RaftVehicle, or a headless run) supplies the body, the particle
 * sinks and — in the browser — the Rapier worker's step. Game speed (#558 D.1)
 * is SimCore's step rate; the step itself always takes `SIM_DT`.
 */
import type { SimSystem } from '../../sim/core/SimCore';
import { createPlayerControls, fillPlayerControls, type PlayerControls } from '../../input/playerControls';
import { createCollisionTracker, type CollisionTracker } from '../../systems/vehicle/VehicleSystem';
import type { RapierBody } from '../../physics/rapierTypes';
import type { ShelfTrigger } from '../utils/shelfLaunch';
import {
  createRaftPhysicsRuntime,
  NO_RAFT_PARTICLES,
  type RaftImpulse,
  type RaftParticleSink,
  type RaftPhysicsRuntime,
} from './hooks/raftPhysicsRuntime';
import { stepRaft, type RaftStepArgs } from './hooks/RaftPhysicsStep';
import { createRaftPhysicsState, resetRaftPhysicsState, type RaftPhysicsState } from './raftPhysicsState';

export const RAFT_SIM_ORDER = 95;
export const RAFT_SIM_ID = 'vehicle-raft';

/** The Rapier worker's half (browser only): who owns the body, and how to post a step. */
export interface RaftWorkerLink {
  /** True once the worker session is ready and owns the body. */
  ownsBody(): boolean;
  /** Post one step's paddle impulses (one in flight at a time; the host drops the rest). */
  step(body: RapierBody, delta: number, impulses: RaftImpulse[]): void;
}

export interface RaftSimBinding {
  /** The raft's body, or null before it exists (the step is skipped). */
  getBody(): RapierBody | null;
  /** Defaults to a fresh state; the host passes its own to read it (HUD, visuals). */
  state?: RaftPhysicsState;
  foamParticles?: RaftParticleSink;
  shedParticles?: RaftParticleSink;
  shelfLaunchFiredRef?: { current: boolean };
  shelfTriggerRef?: { current: ShelfTrigger | null };
  worker?: RaftWorkerLink | null;
  /** The staged water level over the raft (tests); defaults to vehicleWaterDatum's. */
  sampleWaterLevel?: () => number | null;
}

export interface RaftSimSystem extends SimSystem {
  readonly state: RaftPhysicsState;
  readonly runtime: RaftPhysicsRuntime;
  readonly collisions: CollisionTracker;
}

const NO_WORKER_STEP = (): void => undefined;

export function createRaftSimSystem(binding: RaftSimBinding): RaftSimSystem {
  const state = binding.state ?? createRaftPhysicsState();
  const controls: PlayerControls = createPlayerControls();
  const collisions = createCollisionTracker();
  const worker = binding.worker ?? null;
  // The step's run state, read through the binding the system holds this step.
  let game: RaftStepArgs['game'] | null = null;
  const runtime = createRaftPhysicsRuntime({
    buoyancyState: state.buoyancyState,
    tippingState: state.tippingState,
    paddleState: state.paddleState,
    staminaState: state.staminaState,
    stunState: state.stunState,
    forwardBiasTimer: state.forwardBiasState,
    foamParticles: binding.foamParticles ?? NO_RAFT_PARTICLES,
    shedParticles: binding.shedParticles ?? NO_RAFT_PARTICLES,
    controls: { getControls: () => controls },
    stepWorkerProxy: worker ? (body, delta, impulses = []) => worker.step(body, delta, impulses) : NO_WORKER_STEP,
    currentBiome: () => game?.state().currentBiome ?? '',
    ...(binding.sampleWaterLevel ? { sampleWaterLevel: binding.sampleWaterLevel } : {}),
  });
  const args = {
    shelfLaunchFiredRef: binding.shelfLaunchFiredRef ?? { current: false },
    shelfTriggerRef: binding.shelfTriggerRef ?? { current: null },
  } as RaftStepArgs;

  return {
    id: RAFT_SIM_ID,
    order: RAFT_SIM_ORDER,
    state,
    runtime,
    collisions,
    reset() {
      resetRaftPhysicsState(state);
      runtime.resetStream();
      args.shelfLaunchFiredRef.current = false;
    },
    step(ctx, dt) {
      const body = binding.getBody();
      if (!body) return;
      // The raft reads no pointer-lock state; the frame is the hub's (or a pilot's).
      fillPlayerControls(ctx.input, false, controls);
      game = ctx.game;
      args.delta = dt;
      args.game = ctx.game;
      args.body = body;
      args.controls = controls;
      args.state = state;
      args.runtime = runtime;
      args.collisions = collisions;
      args.workerOwnsBody = worker?.ownsBody() ?? false;
      stepRaft(args);
    },
  };
}
