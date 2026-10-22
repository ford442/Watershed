/**
 * menuNav.ts — gamepad → menu actions (#486 B).
 *
 * The InputHub only ticks inside the Canvas, and the menus are DOM over a
 * Canvas whose world may not even be mounted yet, so menu navigation polls the
 * pad itself — but with the same standard mapping and the same dead-zone maths
 * as the in-game source. This file is the pure part: a small edge/repeat state
 * machine over a `PadLike`, so the D-pad, stick, A / B / Start behaviour is
 * tested without a browser.
 *
 *   d-pad or left stick   up / down / left / right   (repeats while held)
 *   A                     confirm
 *   B                     back
 *   Start                 start (resume on the pause menu, START RUN on the title)
 *
 * A button that is already down when navigation begins is ignored until it is
 * released — otherwise the Start press that paused the game would also resume
 * it on the very next poll.
 */

import { MENU_AXIS_THRESHOLD, PAD_BUTTON, padButton, type PadLike } from './sources/gamepadMapping';

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start';

const ACTIONS: readonly MenuAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'start'];

/** Repeat timing for held directions. */
export const MENU_REPEAT_DELAY_MS = 380;
export const MENU_REPEAT_RATE_MS = 120;

export interface MenuNavState {
  /** Held now, per action (index = ACTIONS order). */
  held: boolean[];
  /** Next time (ms) a held direction may repeat. */
  repeatAt: number[];
}

export function createMenuNavState(): MenuNavState {
  return { held: ACTIONS.map(() => true), repeatAt: ACTIONS.map(() => 0) };
}

function isDown(pad: PadLike, action: MenuAction): boolean {
  switch (action) {
    case 'up':
      return padButton(pad, PAD_BUTTON.UP) > 0.5 || (pad.axes[1] ?? 0) < -MENU_AXIS_THRESHOLD;
    case 'down':
      return padButton(pad, PAD_BUTTON.DOWN) > 0.5 || (pad.axes[1] ?? 0) > MENU_AXIS_THRESHOLD;
    case 'left':
      return padButton(pad, PAD_BUTTON.LEFT) > 0.5 || (pad.axes[0] ?? 0) < -MENU_AXIS_THRESHOLD;
    case 'right':
      return padButton(pad, PAD_BUTTON.RIGHT) > 0.5 || (pad.axes[0] ?? 0) > MENU_AXIS_THRESHOLD;
    case 'confirm':
      return padButton(pad, PAD_BUTTON.A) > 0.5;
    case 'back':
      return padButton(pad, PAD_BUTTON.B) > 0.5;
    case 'start':
      return padButton(pad, PAD_BUTTON.START) > 0.5;
  }
}

function isDirection(action: MenuAction): boolean {
  return action === 'up' || action === 'down' || action === 'left' || action === 'right';
}

/**
 * Advance the state machine by one poll and call `emit` for every action that
 * fired (a press edge, or a repeat of a held direction). Allocation-free.
 */
export function stepMenuNav(
  state: MenuNavState,
  pad: PadLike | null,
  nowMs: number,
  emit: (action: MenuAction) => void,
): void {
  for (let i = 0; i < ACTIONS.length; i += 1) {
    const action = ACTIONS[i];
    const down = pad !== null && pad.connected && isDown(pad, action);
    if (!down) {
      state.held[i] = false;
      continue;
    }
    if (!state.held[i]) {
      state.held[i] = true;
      state.repeatAt[i] = nowMs + MENU_REPEAT_DELAY_MS;
      emit(action);
    } else if (isDirection(action) && state.repeatAt[i] > 0 && nowMs >= state.repeatAt[i]) {
      state.repeatAt[i] = nowMs + MENU_REPEAT_RATE_MS;
      emit(action);
    }
  }
}

/** First connected standard-mapping pad, or null. */
export function firstStandardPad(pads: ArrayLike<PadLike | null>): PadLike | null {
  for (let i = 0; i < pads.length; i += 1) {
    const p = pads[i];
    if (p && p.connected && p.mapping === 'standard') return p;
  }
  return null;
}
