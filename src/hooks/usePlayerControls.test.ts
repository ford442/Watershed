import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlayerControls, useInputFrame } from './usePlayerControls';
import { inputHub, type InputDeviceScratch, type InputSource } from '../input/InputHub';
import { InputButton } from '../input/InputFrame';

class Held implements InputSource {
  readonly id = 'keyboard-mouse' as const;
  next: Partial<InputDeviceScratch> = {};
  poll(out: InputDeviceScratch): void {
    Object.assign(out, this.next);
  }
  dispose(): void {}
}

describe('usePlayerControls adapter', () => {
  afterEach(() => inputHub.reset());

  it('getControls() returns one preallocated object holding the hub snapshot', () => {
    const src = new Held();
    inputHub.registerSource(src);
    const { result } = renderHook(() => usePlayerControls());

    src.next = { moveY: 1, moveX: -1, paddleR: 1, buttons: InputButton.JUMP | InputButton.BRAKE };
    inputHub.tick(1000 / 60, 1);
    const a = result.current.getControls();
    const b = result.current.getControls();
    expect(b).toBe(a);
    expect(a).toMatchObject({
      forward: true,
      backward: false,
      leftward: true,
      rightward: false,
      jump: true,
      brake: true,
      sprint: false,
      dodge: false,
      paddleLeft: false,
      paddleRight: true,
    });

    src.next = { moveY: -1 };
    inputHub.tick(1000 / 60, 2);
    expect(result.current.getControls()).toBe(a);
    expect(a.forward).toBe(false);
    expect(a.backward).toBe(true);
    expect(a.jump).toBe(false);
  });

  it('keeps forwardDir / rightDir as stable instances across renders', () => {
    const { result, rerender } = renderHook(() => usePlayerControls());
    const { forwardDir, rightDir, getControls } = result.current;
    rerender();
    expect(result.current.forwardDir).toBe(forwardDir);
    expect(result.current.rightDir).toBe(rightDir);
    expect(result.current.getControls).toBe(getControls);
  });

  it('useInputFrame() is the hub frame itself', () => {
    const { result } = renderHook(() => useInputFrame());
    expect(result.current).toBe(inputHub.readFrame());
  });
});
