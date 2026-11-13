/**
 * holdToggle.ts — hold vs toggle for sprint, brake and the raft paddles (#558 D.1).
 *
 * Applied once, on the merged frame (InputHub.tick), so every device — keys,
 * pad, touch — gets the same behaviour. In toggle mode a press flips the input
 * on and the next press flips it off; the frame then carries the latched state,
 * which is what the ghost records. A scripted / replay run never passes through
 * here: its frames are already the recorded result.
 */

import { InputButton, type InputFrame } from './InputFrame';
import type { HoldMode } from '../systems/settings/access';

export interface HoldModes {
  sprint: HoldMode;
  brake: HoldMode;
  paddle: HoldMode;
}

export interface HoldToggleState {
  prevButtons: number;
  prevPaddleL: boolean;
  prevPaddleR: boolean;
  sprintOn: boolean;
  brakeOn: boolean;
  paddleLOn: boolean;
  paddleROn: boolean;
}

/** An analog paddle counts as pressed past this pull. */
export const PADDLE_PRESS = 0.5;

export function createHoldToggleState(): HoldToggleState {
  return {
    prevButtons: 0,
    prevPaddleL: false,
    prevPaddleR: false,
    sprintOn: false,
    brakeOn: false,
    paddleLOn: false,
    paddleROn: false,
  };
}

function toggleButton(f: InputFrame, rawPressed: boolean, wasPressed: boolean, on: boolean, bit: number): boolean {
  const next = rawPressed && !wasPressed ? !on : on;
  if (next) f.buttons |= bit;
  else f.buttons &= ~bit;
  return next;
}

/** Rewrite `f` in place for the toggle-mode inputs. Hold-mode inputs pass through. */
export function applyHoldToggle(f: InputFrame, modes: Readonly<HoldModes>, state: HoldToggleState): void {
  const raw = f.buttons;
  const rawL = f.paddleL > PADDLE_PRESS;
  const rawR = f.paddleR > PADDLE_PRESS;

  if (modes.sprint === 'toggle') {
    state.sprintOn = toggleButton(
      f,
      (raw & InputButton.SPRINT) !== 0,
      (state.prevButtons & InputButton.SPRINT) !== 0,
      state.sprintOn,
      InputButton.SPRINT,
    );
  } else state.sprintOn = false;

  if (modes.brake === 'toggle') {
    state.brakeOn = toggleButton(
      f,
      (raw & InputButton.BRAKE) !== 0,
      (state.prevButtons & InputButton.BRAKE) !== 0,
      state.brakeOn,
      InputButton.BRAKE,
    );
  } else state.brakeOn = false;

  if (modes.paddle === 'toggle') {
    if (rawL && !state.prevPaddleL) state.paddleLOn = !state.paddleLOn;
    if (rawR && !state.prevPaddleR) state.paddleROn = !state.paddleROn;
    f.paddleL = state.paddleLOn ? 1 : 0;
    f.paddleR = state.paddleROn ? 1 : 0;
  } else {
    state.paddleLOn = false;
    state.paddleROn = false;
  }

  state.prevButtons = raw;
  state.prevPaddleL = rawL;
  state.prevPaddleR = rawR;
}
