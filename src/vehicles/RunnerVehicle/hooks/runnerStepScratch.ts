/**
 * runnerStepScratch.ts — the runner step's reused working set (#521 D).
 *
 * One per mounted runner, built with its physics state. Each step overwrites
 * it in place, so steady-state running allocates nothing of ours: the
 * per-step values, the impulse tally the debug overlay reads, the vectors the
 * movement math fills, and the argument objects handed to the helpers (their
 * signatures take one object; passing a fresh literal every step was most of
 * the step's garbage). `RunnerPhysicsStep.ts` is the only writer.
 */
import * as THREE from 'three';
import { queryFlags } from '../../../config/queryFlags';
import type { SegmentEnvelope } from '../../../systems/map/segmentFrames';
import type { RapierBody } from '../../../physics/rapierTypes';
import { createGroundRayResult, type GroundRayResult } from './runnerGroundRay';
import { isFiniteImpulse, isFiniteVec3, type PositionBounds, type SprintResult } from './runnerAirControl';

type Vec3 = { x: number; y: number; z: number };

/** Every tag an impulse is tallied under (the debug overlay's legend). */
export const RUNNER_IMPULSE_TAGS = [
  'bankAssist',
  'shelfLaunch',
  'jump',
  'coyoteJump',
  'dodge',
  'flow',
  'forwardInput',
  'backwardInput',
  'leftwardInput',
  'rightwardInput',
  'slideBoost',
  'platformTransfer',
  'waterCurrent',
] as const;

export type RunnerImpulseTag = (typeof RUNNER_IMPULSE_TAGS)[number];

export interface RunnerStepScratch {
  /**
   * Boot flags, read once when the runner mounts (the step used to re-parse
   * the query string every frame): `?no-pointer-lock` and whether the debug
   * snapshot is published (`queryFlags().debugGlobals`).
   */
  noPointerLock: boolean;
  debugGlobals: boolean;
  /** The body being stepped (set at the top of each step). */
  body: RapierBody | null;
  /** Gameplay impulses / velocity writes are let through only once everything is sane (F-8). */
  physicsWarm: boolean;
  /** Per-tag impulse sums for this step, and whether the tag fired. */
  impulseTotals: Record<RunnerImpulseTag, Vec3>;
  impulseUsed: Record<RunnerImpulseTag, boolean>;
  /** Apply (when warm) and tally an impulse. Bound once; never reallocated. */
  applyImpulse: (tag: string, impulse: Vec3) => void;
  /** `body.setLinvel` when warm and finite. Bound once. */
  setLinvelSafe: (nextVel: Vec3) => void;
  /** Scratch impulse the step's own xyz impulses are written into. */
  impulse: Vec3;
  envelope: SegmentEnvelope;
  bounds: PositionBounds;
  ground: GroundRayResult;
  forwardDir: THREE.Vector3;
  rightDir: THREE.Vector3;
  sprint: SprintResult;
  /** What the step last wrote to Rapier (re-written only on change). */
  applied: {
    body: RapierBody | null;
    colliders: number;
    friction: number;
    dampingBody: RapierBody | null;
    damping: number;
  };
}

function zeroVec(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

export function createRunnerStepScratch(): RunnerStepScratch {
  const impulseTotals = {} as Record<RunnerImpulseTag, Vec3>;
  const impulseUsed = {} as Record<RunnerImpulseTag, boolean>;
  for (const tag of RUNNER_IMPULSE_TAGS) {
    impulseTotals[tag] = zeroVec();
    impulseUsed[tag] = false;
  }

  const flags = queryFlags();
  const scratch: RunnerStepScratch = {
    noPointerLock: flags.noPointerLock,
    debugGlobals: flags.debugGlobals,
    body: null,
    physicsWarm: false,
    impulseTotals,
    impulseUsed,
    applyImpulse: (tag, impulse) => {
      const body = scratch.body;
      if (!body || !scratch.physicsWarm || !isFiniteImpulse(impulse)) return;
      body.applyImpulse(impulse, true);
      const key = tag as RunnerImpulseTag;
      const total = impulseTotals[key];
      if (!total) return;
      if (impulseUsed[key]) {
        total.x += impulse.x;
        total.y += impulse.y;
        total.z += impulse.z;
      } else {
        impulseUsed[key] = true;
        total.x = impulse.x;
        total.y = impulse.y;
        total.z = impulse.z;
      }
    },
    setLinvelSafe: (nextVel) => {
      const body = scratch.body;
      if (!body || !scratch.physicsWarm || !isFiniteVec3(nextVel)) return;
      body.setLinvel(nextVel, true);
    },
    impulse: zeroVec(),
    envelope: { yMin: 0, yMax: 0, segmentIndex: null, authored: false },
    bounds: { yMin: 0, yMax: 0, xzMax: 0, speedMax: 0 },
    ground: createGroundRayResult(),
    forwardDir: new THREE.Vector3(),
    rightDir: new THREE.Vector3(),
    sprint: { isSprinting: false, movementMul: 1 },
    applied: { body: null, colliders: -1, friction: -1, dampingBody: null, damping: -1 },
  };
  return scratch;
}

/** Start of a step: no impulse has fired yet. */
export function resetImpulseTally(scratch: RunnerStepScratch): void {
  for (let i = 0; i < RUNNER_IMPULSE_TAGS.length; i += 1) scratch.impulseUsed[RUNNER_IMPULSE_TAGS[i]] = false;
}

/** Apply + tally `(x, y, z)` under `tag` through the scratch impulse (no literal). */
export function applyImpulseXYZ(scratch: RunnerStepScratch, tag: RunnerImpulseTag, x: number, y: number, z: number): void {
  const impulse = scratch.impulse;
  impulse.x = x;
  impulse.y = y;
  impulse.z = z;
  scratch.applyImpulse(tag, impulse);
}

/** `body.setLinvel` (warm, finite) through the scratch vector. */
export function setLinvelXYZ(scratch: RunnerStepScratch, x: number, y: number, z: number): void {
  const v = scratch.impulse;
  v.x = x;
  v.y = y;
  v.z = z;
  scratch.setLinvelSafe(v);
}
