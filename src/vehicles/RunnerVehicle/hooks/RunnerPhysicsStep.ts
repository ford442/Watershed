/**
 * RunnerPhysicsStep.ts — one physics step of the first-person runner.
 *
 * `updateRunnerPhysics` runs the stages in a fixed order (#521 C): the order is
 * the behaviour — impulses accumulate into Rapier in the order they are
 * applied, so a stage never moves:
 *
 *   checkBodySanity → sampleGround → applyTerrainResponse → applyInput →
 *   integrate → applyWaterForces → markCameraFollow → writeTelemetry
 *
 * This file is the stage list; each stage is its own module under
 * `runnerStep/` (#559 C), sharing the per-step frame (`runnerStep/stepFrame.ts`).
 * The helpers' argument objects are reused too — module-level in each stage,
 * rewritten field by field each step instead of a fresh literal per call;
 * module-level is safe because a step runs to completion and nothing keeps
 * the object.
 *
 * Every stage works on the runner's reused scratch (`runnerStepScratch.ts`):
 * steady-state running allocates nothing of ours (#521 D;
 * `runnerStep.alloc.perf.test.ts`). The debug snapshot and its `window`
 * global are built only on a `?debug` / `?physicsDebug` / `?screenshot` page.
 * Survival is integrated by SimCore's `survival` system; the step reads its
 * modifiers (sprint).
 *
 * Headless-safe (#556 A): the step is SimCore's `vehicle-runner` system
 * (runnerSimSystem.ts). It reads and writes the run through `args.game`
 * (ctx.game), never the Zustand store; sounds, shake and collision bursts go
 * out as `vehicle-*` cues; and the camera's follow / FOV kick are the R3F
 * host's (runnerCameraSync.ts) — the step reads the camera's orientation for
 * camera-relative movement and only flags whether the camera may follow.
 */
import type * as THREE from 'three';
import type { SimGamePort } from '../../../sim/core/simGame';
import type { SimDebugSink } from '../../../sim/core/SimCore';
import type { RapierBody, RapierNamespace, RapierWorld } from '../../../physics/rapierTypes';
import type { PlayerControls } from '../../../input/playerControls';
import type { ShelfTrigger } from '../../utils/shelfLaunch';
import type { RunnerPhysicsState } from './runnerPhysicsState';
import { frameFor } from './runnerStep/stepFrame';
import { checkBodySanity } from './runnerStep/checkBodySanity';
import { sampleGround } from './runnerStep/sampleGround';
import { applyTerrainResponse } from './runnerStep/applyTerrainResponse';
import { applyInput } from './runnerStep/applyInput';
import { integrate } from './runnerStep/integrate';
import { applyWaterForces } from './runnerStep/applyWaterForces';
import { writeTelemetry } from './runnerStep/writeTelemetry';

export interface RunnerPhysicsStepArgs {
  delta: number;
  /** The run's state (ctx.game): stamina, segment, spawn points, wipeout latch. */
  game: SimGamePort;
  /** Where the debug snapshot goes (ctx.debug): the browser's taps, or nothing. */
  debug: SimDebugSink;
  world: RapierWorld;
  body: RapierBody;
  rapier: RapierNamespace;
  camera: THREE.PerspectiveCamera;
  controls: { getControls: () => PlayerControls };
  vehicleState: RunnerPhysicsState;
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ShelfTrigger | null };
}

export function updateRunnerPhysics(args: RunnerPhysicsStepArgs): void {
  const f = frameFor(args);
  if (!checkBodySanity(f)) return;
  sampleGround(f);
  applyTerrainResponse(f);
  applyInput(f);
  integrate(f);
  applyWaterForces(f);
  f.s.followCamera = true;
  writeTelemetry(f);
}
