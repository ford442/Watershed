/**
 * playerControls.ts — the `PlayerControls` shape the runner / raft steps read,
 * filled from one InputFrame (#486 A). Pure and allocation-free: the R3F
 * adapter (`hooks/usePlayerControls`) and the vehicle sim systems (#556 A)
 * share it, so a headless run maps a pilot's frames exactly as the game does.
 */
import { InputButton, type InputFrame } from './InputFrame';

export interface PlayerControls {
  /** Forward input (W / ArrowUp) */
  forward: boolean;
  /** Backward input (S / ArrowDown) */
  backward: boolean;
  /** Left strafe (A / ArrowLeft) */
  leftward: boolean;
  /** Right strafe (D / ArrowRight) */
  rightward: boolean;
  /** Jump (Space) */
  jump: boolean;
  /** Sprint / boost (Shift) */
  sprint: boolean;
  /** Brake / slide */
  brake: boolean;
  /** Dodge / dash (Alt) */
  dodge: boolean;
  /** Left paddle (Q) — raft only */
  paddleLeft: boolean;
  /** Right paddle (E) — raft only */
  paddleRight: boolean;
  /** Left trigger / Q pull, 0..1 — scales a raft stroke (#486 B). Keys report 0 or 1. */
  paddleLeftAxis: number;
  /** Right trigger / E pull, 0..1 */
  paddleRightAxis: number;
  /** Is pointer lock currently active */
  isPointerLocked: boolean;
}

/** Axis magnitude that counts as a held digital direction. */
const AXIS_PRESSED = 0.5;

/** Fill `out` from a hub frame. Pure, allocation-free. */
export function fillPlayerControls(
  frame: Readonly<InputFrame>,
  isPointerLocked: boolean,
  out: PlayerControls,
): PlayerControls {
  const b = frame.buttons;
  out.forward = frame.moveY > AXIS_PRESSED;
  out.backward = frame.moveY < -AXIS_PRESSED;
  out.leftward = frame.moveX < -AXIS_PRESSED;
  out.rightward = frame.moveX > AXIS_PRESSED;
  out.jump = (b & InputButton.JUMP) !== 0;
  out.sprint = (b & InputButton.SPRINT) !== 0;
  out.brake = (b & InputButton.BRAKE) !== 0;
  out.dodge = (b & InputButton.DODGE) !== 0;
  out.paddleLeft = frame.paddleL > AXIS_PRESSED;
  out.paddleRight = frame.paddleR > AXIS_PRESSED;
  out.paddleLeftAxis = frame.paddleL;
  out.paddleRightAxis = frame.paddleR;
  out.isPointerLocked = isPointerLocked;
  return out;
}

export function createPlayerControls(): PlayerControls {
  return {
    forward: false,
    backward: false,
    leftward: false,
    rightward: false,
    jump: false,
    sprint: false,
    brake: false,
    dodge: false,
    paddleLeft: false,
    paddleRight: false,
    paddleLeftAxis: 0,
    paddleRightAxis: 0,
    isPointerLocked: false,
  };
}
