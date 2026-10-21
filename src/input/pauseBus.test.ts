import { describe, expect, it, vi } from 'vitest';
import { emitPauseRequest, onPauseRequest, pauseEdge } from './pauseBus';
import { InputButton } from './InputFrame';

describe('pauseBus', () => {
  it('delivers to every listener until unsubscribed', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onPauseRequest(a);
    const offB = onPauseRequest(b);
    emitPauseRequest();
    offA();
    emitPauseRequest();
    offB();
    emitPauseRequest();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('fires on the press edge only, not while held', () => {
    const P = InputButton.PAUSE;
    expect(pauseEdge(0, P, P)).toBe(true);
    expect(pauseEdge(P, P, P)).toBe(false);
    expect(pauseEdge(P, 0, P)).toBe(false);
    expect(pauseEdge(InputButton.JUMP, InputButton.JUMP | P, P)).toBe(true);
  });
});
