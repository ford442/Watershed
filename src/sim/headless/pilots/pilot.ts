/**
 * pilot.ts — a headless driver for the runner (#556 C).
 *
 * A pilot is a `HeadlessInput` (what `stepHeadless` already takes): an `InputSource` the hub
 * polls, plus the camera heading it holds. It differs from a script in one way: it reads the
 * run. Each poll it looks at the body, the live segment frames and the store, decides once, and
 * writes the frame's `moveX` / `moveY` / buttons; `look()` hands back the same decision's yaw.
 * The runner's movement is camera-relative (`buildCameraRelativeDirsInto`) and the hub's axes are
 * digital (`> AXIS_PRESSED`), so the yaw IS the steering wheel: a pilot turns by looking.
 *
 * The decision itself is a `PilotPolicy`: a function of a `PilotView` into a `PilotCommand`, both
 * preallocated and mutated in place (a policy may keep closure state: a sprint latch, a progress
 * mark). `createPilot` is the plumbing; `centreline.ts` and `ghost.ts` are the first two pilots.
 *
 * Headless only: never imported by app code (scripts/check-dependency-direction.mjs).
 */
import type { InputDeviceScratch, InputSource } from '../../../input/InputHub';
import { getSegmentFrames, type SegmentFrame } from '../../../systems/map/segmentFrames';
import { useGameStore } from '../../../systems/GameState';
import type { HeadlessRun } from '../createHeadlessRun';
import type { HeadlessInput } from '../stepHeadless';

/** What a policy sees this frame. Fields are rewritten in place before every call. */
export interface PilotView {
  readonly run: HeadlessRun;
  /** Body position. */
  x: number;
  y: number;
  z: number;
  /** Body velocity. */
  vx: number;
  vy: number;
  vz: number;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Sprint stamina, 0..1 (`useGameStore.sprintStamina`). */
  stamina: number;
  /** The store's current segment index. */
  segmentIndex: number;
  /** Sim frames stepped so far (`run.clock.frame`). */
  frame: number;
  /** The live segment frames (`getSegmentFrames()`), as published by the treadmill. */
  frames: ReadonlyArray<SegmentFrame>;
}

/** What a policy writes: one frame of the runner's controls. */
export interface PilotCommand {
  /** Strafe axis, −1..1 (pressed beyond the hub's threshold). */
  moveX: number;
  /** Forward axis, −1..1. */
  moveY: number;
  /** `InputButton` bits. */
  buttons: number;
  /** Camera yaw, radians (0 faces −Z, downstream; positive turns toward −X). */
  yaw: number;
  /** Camera pitch, radians. */
  pitch: number;
}

export type PilotPolicy = (view: PilotView, out: PilotCommand) => void;

export interface Pilot extends HeadlessInput {
  readonly name: string;
  /** The last command the pilot wrote (read-only for tests and reports). */
  readonly command: Readonly<PilotCommand>;
}

/** Yaw that faces the horizontal direction `(dx, dz)` (0 = −Z). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Build a pilot over `run` from `policy`. */
export function createPilot(run: HeadlessRun, name: string, policy: PilotPolicy): Pilot {
  const view: PilotView = {
    run,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    speed: 0,
    stamina: 1,
    segmentIndex: 0,
    frame: 0,
    frames: [],
  };
  const command: PilotCommand = { moveX: 0, moveY: 0, buttons: 0, yaw: 0, pitch: 0 };
  const look: [number, number] = [0, 0];

  const source: InputSource = {
    id: 'scripted',
    poll(out: InputDeviceScratch) {
      const p = run.body.translation();
      const v = run.body.linvel();
      const store = useGameStore.getState();
      view.x = p.x;
      view.y = p.y;
      view.z = p.z;
      view.vx = v.x;
      view.vy = v.y;
      view.vz = v.z;
      view.speed = Math.sqrt(v.x * v.x + v.z * v.z);
      view.stamina = store.sprintStamina;
      view.segmentIndex = store.currentSegmentIndex;
      view.frame = run.clock.frame;
      view.frames = getSegmentFrames();
      policy(view, command);
      out.moveX = command.moveX;
      out.moveY = command.moveY;
      out.buttons = command.buttons;
    },
    dispose() {},
  };

  return {
    name,
    source,
    command,
    look() {
      look[0] = command.yaw;
      look[1] = command.pitch;
      return look;
    },
  };
}
