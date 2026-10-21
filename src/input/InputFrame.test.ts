import { describe, expect, it } from 'vitest';
import {
  createInputFrame,
  decodeInputFrame,
  encodeInputFrame,
  GHOST_BUTTON_MASK,
  hasButton,
  INPUT_BUTTON_SLOT_MAX,
  INPUT_FRAME_FLOATS,
  InputButton,
} from './InputFrame';

describe('InputFrame codec', () => {
  it('round-trips every encoded field through 8 floats', () => {
    const frame = createInputFrame();
    frame.moveX = -1;
    frame.moveY = 0.5;
    frame.lookDX = 12;
    frame.lookDY = -3;
    frame.paddleL = 1;
    frame.paddleR = 0.25;
    frame.buttons = InputButton.JUMP | InputButton.DODGE;
    frame.dtMs = 16.6667;

    const out = new Float32Array(INPUT_FRAME_FLOATS * 2);
    encodeInputFrame(frame, out, INPUT_FRAME_FLOATS);
    expect(Array.from(out.subarray(0, INPUT_FRAME_FLOATS))).toEqual(new Array(8).fill(0));

    const back = decodeInputFrame(out, INPUT_FRAME_FLOATS, createInputFrame());
    expect(back.moveX).toBe(-1);
    expect(back.moveY).toBe(0.5);
    expect(back.lookDX).toBe(12);
    expect(back.lookDY).toBe(-3);
    expect(back.paddleL).toBe(1);
    expect(back.paddleR).toBe(0.25);
    expect(back.buttons).toBe(InputButton.JUMP | InputButton.DODGE);
    expect(back.dtMs).toBeCloseTo(16.6667, 3);
    expect(hasButton(back, InputButton.JUMP)).toBe(true);
    expect(hasButton(back, InputButton.SPRINT)).toBe(false);
  });

  it('carries a full 24-bit bitfield exactly in a float32 slot', () => {
    const frame = createInputFrame();
    frame.buttons = INPUT_BUTTON_SLOT_MAX;
    const out = new Float32Array(INPUT_FRAME_FLOATS);
    encodeInputFrame(frame, out, 0, INPUT_BUTTON_SLOT_MAX);
    expect(decodeInputFrame(out, 0, createInputFrame()).buttons).toBe(INPUT_BUTTON_SLOT_MAX);

    // Bit 24 and above would round in float32 — the slot drops them instead.
    frame.buttons = INPUT_BUTTON_SLOT_MAX + 1;
    encodeInputFrame(frame, out, 0, 0x7fffffff);
    expect(out[6]).toBe(0);
  });

  it('masks PAUSE out of the ghost encoding', () => {
    const frame = createInputFrame();
    frame.buttons = InputButton.PAUSE | InputButton.JUMP;
    const out = new Float32Array(INPUT_FRAME_FLOATS);
    encodeInputFrame(frame, out, 0, GHOST_BUTTON_MASK);
    const back = decodeInputFrame(out, 0, createInputFrame());
    expect(hasButton(back, InputButton.PAUSE)).toBe(false);
    expect(hasButton(back, InputButton.JUMP)).toBe(true);
  });

  it('encodes and decodes without allocating', () => {
    const frame = createInputFrame();
    const into = createInputFrame();
    const out = new Float32Array(INPUT_FRAME_FLOATS);
    let lastOut: Float32Array | null = null;
    for (let i = 0; i < 10_000; i += 1) {
      frame.moveX = (i % 3) - 1;
      frame.buttons = i & 0x1f;
      const ret = encodeInputFrame(frame, out, 0);
      if (lastOut) expect(ret).toBe(lastOut);
      lastOut = ret;
      expect(decodeInputFrame(out, 0, into)).toBe(into);
    }
    expect(lastOut).toBe(out);
  });
});
