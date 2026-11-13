import { describe, expect, it } from 'vitest';
import { InputButton, createInputFrame } from './InputFrame';
import { applyHoldToggle, createHoldToggleState } from './holdToggle';

const HOLD = { sprint: 'hold', brake: 'hold', paddle: 'hold' } as const;
const TOGGLE = { sprint: 'toggle', brake: 'toggle', paddle: 'toggle' } as const;

function run(modes: typeof HOLD | typeof TOGGLE, presses: number[]): number[] {
  const state = createHoldToggleState();
  const f = createInputFrame();
  return presses.map((buttons) => {
    f.buttons = buttons;
    applyHoldToggle(f, modes, state);
    return f.buttons;
  });
}

describe('hold / toggle (#558 D.1)', () => {
  it('hold passes every frame through unchanged', () => {
    const presses = [0, InputButton.SPRINT, InputButton.SPRINT, 0, InputButton.BRAKE | InputButton.JUMP];
    expect(run(HOLD, presses)).toEqual(presses);
  });

  it('toggle latches sprint on a press and off on the next press', () => {
    const S = InputButton.SPRINT;
    expect(run(TOGGLE, [0, S, S, 0, 0, S, 0])).toEqual([0, S, S, S, S, 0, 0]);
  });

  it('toggle leaves other buttons alone', () => {
    const J = InputButton.JUMP;
    expect(run(TOGGLE, [J, 0, J])).toEqual([J, 0, J]);
  });

  it('toggles an analog paddle past the press threshold', () => {
    const state = createHoldToggleState();
    const f = createInputFrame();
    const pull = (l: number) => {
      f.paddleL = l;
      applyHoldToggle(f, TOGGLE, state);
      return f.paddleL;
    };
    expect([pull(0.2), pull(0.9), pull(0), pull(0), pull(0.8), pull(0)]).toEqual([0, 1, 1, 1, 0, 0]);
  });
});
