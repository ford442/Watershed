/**
 * The runner step's per-step frame (#521 C; split out of `RunnerPhysicsStep.ts`
 * in #559 C): the reads every stage shares, one per runner, rewritten each step,
 * plus the two helpers more than one stage calls.
 */
import type { PlayerControls } from '../../../../input/playerControls';
import { RUNNER_CONTACT_FRICTION } from '../../../../systems/vehicle/VehicleSystem';
import { BANK_CONFIG } from '../../constants';
import type { RunnerPhysicsStepArgs } from '../RunnerPhysicsStep';
import { holdBodyAtSpawn } from '../runnerAirControl';
import type { RunnerStepScratch } from '../runnerStepScratch';

export type Vec3 = { x: number; y: number; z: number };

/** One step's reads, shared by the stages (one per runner, rewritten each step). */
export interface StepFrame {
  args: RunnerPhysicsStepArgs;
  s: RunnerStepScratch;
  dt: number;
  pos: Vec3;
  vel: Vec3;
  /** Sim ms (the debug overlay's clock). */
  now: number;
  noPointerLock: boolean;
  dtOk: boolean;
  posOk: boolean;
  /** Body, velocity, camera and dt all sane (F-8); terrain readiness is added in sampleGround. */
  sane: boolean;
  cameraWarm: boolean;
  isGrounded: boolean;
  slopeAngle: number;
  gravMult: number;
  userData: Record<string, unknown>;
  /** The control state read for this step. */
  controls: PlayerControls | null;
  speed: number;
  /** Contact friction / linear damping this step wants on the body. */
  friction: number;
  damping: number;
}

const stepFrames = new WeakMap<RunnerStepScratch, StepFrame>();

export function frameFor(args: RunnerPhysicsStepArgs): StepFrame {
  const s = args.vehicleState.stepScratch;
  let f = stepFrames.get(s);
  if (!f) {
    f = {
      args, s, dt: 0, pos: s.impulse, vel: s.impulse, now: 0, noPointerLock: false,
      dtOk: false, posOk: false, sane: false, cameraWarm: false, isGrounded: false,
      slopeAngle: 0, gravMult: 1, userData: {}, controls: null, speed: 0,
      friction: RUNNER_CONTACT_FRICTION, damping: 0,
    };
    stepFrames.set(s, f);
  }
  f.args = args;
  return f;
}

/** Park the body: on its OOB latch, else the envelope's respawn point, else the spawn. */
export function holdAtSpawn(f: StepFrame, envelope: RunnerStepScratch['envelope'] | null): void {
  // After an OOB the body is parked on its checkpoint until the terrain ray
  // lands again; without the latch the terrain-warm hold would yank it to the
  // world-origin spawn in the meantime.
  const latched = f.userData.__holdTarget as Vec3 | undefined;
  const respawnPoint =
    latched ??
    (envelope?.respawnAt !== undefined ? f.args.game.state().spawnPoints[envelope.respawnAt] : undefined);
  holdBodyAtSpawn(f.args.body, respawnPoint);
}

/** Bank-assist bonus 0..1 for a bank steeper than the assist threshold. */
export function bankT(absBankDeg: number): number {
  return Math.min(1.0, (absBankDeg - BANK_CONFIG.ASSIST_THRESHOLD) /
                       (BANK_CONFIG.MAX_BANK_DEG - BANK_CONFIG.ASSIST_THRESHOLD));
}
