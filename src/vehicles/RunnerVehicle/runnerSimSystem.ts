/**
 * runnerSimSystem.ts — the runner's physics step as a SimCore system (#556 A).
 *
 * The step used to run in a `useFrame` with R3F's frame delta, so the runner
 * only moved while its React component was mounted and rendering. It is now
 * `vehicle-runner` in SimCore's registry: the same fixed `SIM_DT`, the same
 * `ctx.input` frame and `ctx.game` run state as every other system, stepped by
 * a real frame's accumulator, a scripted frame or a headless run alike.
 *
 * The host supplies the Rapier world and body and the camera it steers by
 * (RunnerVehicle registers the system for its mount; a headless run builds
 * the binding itself). Nothing here imports React, the store, audio or a
 * component.
 *
 * Order 95: after scoring (90). The step runs where it ran in a frame
 * relative to the other systems — after all of them — so survival's
 * modifiers and the score it reads are this step's, as before.
 */
import type * as THREE from 'three';
import type { SimSystem } from '../../sim/core/SimCore';
import { createPlayerControls, fillPlayerControls, type PlayerControls } from '../../input/playerControls';
import type { RapierBody, RapierNamespace, RapierWorld } from '../../physics/rapierTypes';
import type { ShelfTrigger } from '../utils/shelfLaunch';
import { updateRunnerPhysics, type RunnerPhysicsStepArgs } from './hooks/RunnerPhysicsStep';
import type { RunnerPhysicsState } from './hooks/runnerPhysicsState';

export const RUNNER_SIM_ORDER = 95;
export const RUNNER_SIM_ID = 'vehicle-runner';

export interface RunnerSimBinding {
  world: RapierWorld;
  rapier: RapierNamespace;
  /** The runner's body, or null before it exists (the step is skipped). */
  getBody(): RapierBody | null;
  /** The camera movement is relative to (its orientation; the host moves it). */
  camera: THREE.PerspectiveCamera;
  vehicleState: RunnerPhysicsState;
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ShelfTrigger | null };
}

export function createRunnerSimSystem(binding: RunnerSimBinding): SimSystem {
  const controls: PlayerControls = createPlayerControls();
  const controlSource = { getControls: () => controls };
  // One argument object, rewritten per step (#521 D).
  const args = {} as RunnerPhysicsStepArgs;
  return {
    id: RUNNER_SIM_ID,
    order: RUNNER_SIM_ORDER,
    step(ctx, dt) {
      const body = binding.getBody();
      if (!body) return;
      // The runner reads no pointer-lock state; the frame is the hub's (or a pilot's).
      fillPlayerControls(ctx.input, false, controls);
      args.delta = dt;
      args.game = ctx.game;
      args.world = binding.world;
      args.body = body;
      args.rapier = binding.rapier;
      args.camera = binding.camera;
      args.controls = controlSource;
      args.vehicleState = binding.vehicleState;
      args.shelfLaunchFiredRef = binding.shelfLaunchFiredRef;
      args.shelfTriggerRef = binding.shelfTriggerRef;
      updateRunnerPhysics(args);
    },
  };
}
