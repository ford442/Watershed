import { beforeEach, describe, expect, it } from 'vitest';
import {
  decodeGhost,
  decodeGhostFromBase64,
  encodeGhostBuffer,
  encodeGhostSamples,
  encodeGhostToBase64,
  GHOST_BYTES_PER_SAMPLE,
  GHOST_CODEC_VERSION,
  GHOST_FLOATS_PER_SAMPLE,
  GHOST_POSE_FLOATS,
  readGhostInput,
  type GhostSample,
} from './ghostCodec';
import {
  GHOST_MAX_SAMPLES,
  getCurrentGhostPayload,
  resetGhostRecording,
  startGhostRecording,
  tickGhostRecording,
  GHOST_SAMPLE_INTERVAL,
} from './GhostRecorder';
import { createInputFrame, hasButton, InputButton } from '../../input/InputFrame';
import { inputHub, type InputDeviceScratch, type InputSource } from '../../input/InputHub';

const SAMPLE_A: GhostSample = {
  px: 1,
  py: 2,
  pz: -3,
  qx: 0,
  qy: 0.3826834,
  qz: 0,
  qw: 0.9238795,
};

const SAMPLE_B: GhostSample = {
  px: 1.4,
  py: 2.1,
  pz: -4.2,
  qx: 0.01,
  qy: 0.4,
  qz: 0.02,
  qw: 0.91,
};

const SAMPLE_C: GhostSample = {
  px: 1.8,
  py: 2.05,
  pz: -5.5,
  qx: 0.02,
  qy: 0.41,
  qz: 0.03,
  qw: 0.9,
};

describe('ghostCodec', () => {
  it('round-trips absolute samples through delta encode/decode', () => {
    const encoded = encodeGhostSamples([SAMPLE_A, SAMPLE_B, SAMPLE_C]);
    const decoded = decodeGhost(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.sampleCount).toBe(3);

    const samples = decoded!.samples;
    for (let i = 0; i < 3; i += 1) {
      const offset = i * GHOST_FLOATS_PER_SAMPLE;
      expect(samples[offset]).toBeCloseTo([SAMPLE_A, SAMPLE_B, SAMPLE_C][i].px, 5);
      expect(samples[offset + 1]).toBeCloseTo([SAMPLE_A, SAMPLE_B, SAMPLE_C][i].py, 5);
      expect(samples[offset + 2]).toBeCloseTo([SAMPLE_A, SAMPLE_B, SAMPLE_C][i].pz, 5);
      expect(samples[offset + 3]).toBeCloseTo([SAMPLE_A, SAMPLE_B, SAMPLE_C][i].qx, 5);
      expect(samples[offset + 4]).toBeCloseTo([SAMPLE_A, SAMPLE_B, SAMPLE_C][i].qy, 5);
      expect(samples[offset + 5]).toBeCloseTo([SAMPLE_A, SAMPLE_B, SAMPLE_C][i].qz, 5);
      expect(samples[offset + 6]).toBeCloseTo([SAMPLE_A, SAMPLE_B, SAMPLE_C][i].qw, 5);
    }
  });

  it('round-trips through base64 storage format', () => {
    const encoded = encodeGhostSamples([SAMPLE_A, SAMPLE_B]);
    const payload = encodeGhostToBase64(encoded);
    const decoded = decodeGhostFromBase64(payload);

    expect(decoded?.sampleCount).toBe(2);
    expect(decoded?.samples[0]).toBeCloseTo(SAMPLE_A.px, 5);
    expect(decoded?.samples[GHOST_FLOATS_PER_SAMPLE]).toBeCloseTo(SAMPLE_B.px, 5);
  });

  it('rejects malformed float lengths', () => {
    expect(decodeGhost(new Float32Array([1, 2, 3]))).toBeNull();
  });

  it('stores the 15-float v4 stride (7 pose + 8 input)', () => {
    expect(GHOST_CODEC_VERSION).toBe(4);
    expect(GHOST_FLOATS_PER_SAMPLE).toBe(15);
    expect(GHOST_BYTES_PER_SAMPLE).toBe(60);
  });

  it('round-trips an input track next to the poses, PAUSE masked', () => {
    const input = createInputFrame();
    input.moveY = 1;
    input.moveX = -0.5;
    input.paddleL = 0.25;
    input.buttons = InputButton.JUMP | InputButton.PAUSE;
    input.dtMs = 100;
    const decoded = decodeGhost(encodeGhostSamples([SAMPLE_A, { ...SAMPLE_B, input }]));
    expect(decoded?.codecVersion).toBe(4);
    expect(decoded?.sampleCount).toBe(2);

    const first = readGhostInput(decoded!, 0);
    expect(first.moveY).toBe(0);
    expect(first.buttons).toBe(0);

    const second = readGhostInput(decoded!, 1);
    expect(second.moveY).toBe(1);
    expect(second.moveX).toBe(-0.5);
    expect(second.paddleL).toBe(0.25);
    expect(second.dtMs).toBe(100);
    expect(hasButton(second, InputButton.JUMP)).toBe(true);
    expect(hasButton(second, InputButton.PAUSE)).toBe(false);
    expect(decoded!.samples[GHOST_FLOATS_PER_SAMPLE]).toBeCloseTo(SAMPLE_B.px, 5);
  });

  it('decodes a frozen v3 payload (stride 7, no header) with zero-filled input', () => {
    // encodeGhostToBase64(encodeGhostSamples([SAMPLE_A, SAMPLE_B])) as written by codec v3.
    const V3_FIXTURE = 'AACAPwAAAEAAAEDAAAAAABTvwz4AAAAAXoNsP83MzD7NzMw9mpmZvwrXIzyL2408CtejPNhmY7w=';
    const decoded = decodeGhostFromBase64(V3_FIXTURE);
    expect(decoded?.codecVersion).toBe(3);
    expect(decoded?.sampleCount).toBe(2);
    expect(decoded!.samples.length).toBe(2 * GHOST_FLOATS_PER_SAMPLE);
    const poses = [SAMPLE_A, SAMPLE_B];
    for (let i = 0; i < 2; i += 1) {
      const o = i * GHOST_FLOATS_PER_SAMPLE;
      expect(decoded!.samples[o]).toBeCloseTo(poses[i].px, 5);
      expect(decoded!.samples[o + 2]).toBeCloseTo(poses[i].pz, 5);
      expect(decoded!.samples[o + 6]).toBeCloseTo(poses[i].qw, 5);
      for (let j = GHOST_POSE_FLOATS; j < GHOST_FLOATS_PER_SAMPLE; j += 1) {
        expect(decoded!.samples[o + j]).toBe(0);
      }
    }
  });

  it('never lets PAUSE into an encoded buffer sample', () => {
    const buffer = new Float32Array(GHOST_FLOATS_PER_SAMPLE);
    buffer[6] = 1;
    buffer[GHOST_POSE_FLOATS + 6] = InputButton.PAUSE | InputButton.SPRINT;
    const decoded = decodeGhost(encodeGhostBuffer(buffer, 1));
    expect(readGhostInput(decoded!, 0).buttons).toBe(InputButton.SPRINT);
  });
});

/** Device the hub polls; `next` is what it reports this tick. */
class Scripted implements InputSource {
  readonly id = 'scripted' as const;
  next: Partial<InputDeviceScratch> = {};
  poll(out: InputDeviceScratch): void {
    Object.assign(out, this.next);
  }
  dispose(): void {}
}

describe('GhostRecorder input track', () => {
  const DT_MS = 1000 / 60;
  const pose = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  let src: Scripted;

  beforeEach(() => {
    inputHub.reset();
    src = new Scripted();
    inputHub.registerSource(src);
    resetGhostRecording();
    startGhostRecording();
  });

  it('keeps a 2-frame jump tap that falls between 10 Hz samples', () => {
    for (let i = 0; i < 6; i += 1) {
      src.next = { moveY: 1, buttons: i === 2 || i === 3 ? InputButton.JUMP | InputButton.PAUSE : 0 };
      inputHub.tick(DT_MS, i + 1);
      // Sample lands on the 6th frame (100 ms), long after the tap released.
      tickGhostRecording(i === 5 ? GHOST_SAMPLE_INTERVAL : 0.0001, pose);
    }
    const decoded = decodeGhostFromBase64(getCurrentGhostPayload()!);
    expect(decoded?.sampleCount).toBe(1);
    const input = readGhostInput(decoded!, 0);
    expect(hasButton(input, InputButton.JUMP)).toBe(true);
    expect(hasButton(input, InputButton.PAUSE)).toBe(false);
    expect(input.moveY).toBeCloseTo(1, 5);
    inputHub.reset();
  });

  it('copies the latch by value — later ticks never rewrite a stored sample', () => {
    src.next = { moveX: 1 };
    inputHub.tick(DT_MS, 1);
    tickGhostRecording(GHOST_SAMPLE_INTERVAL, pose);
    src.next = { moveX: -1 };
    inputHub.tick(DT_MS, 2);
    tickGhostRecording(GHOST_SAMPLE_INTERVAL, pose);
    const decoded = decodeGhostFromBase64(getCurrentGhostPayload()!);
    expect(readGhostInput(decoded!, 0).moveX).toBe(1);
    expect(readGhostInput(decoded!, 1).moveX).toBe(-1);
    inputHub.reset();
  });

  it('a full 3000-sample v4 recording persists under the localStorage budget', () => {
    src.next = { moveY: 1, moveX: 0.3, paddleL: 0.7, buttons: InputButton.SPRINT };
    for (let i = 0; i < GHOST_MAX_SAMPLES; i += 1) {
      inputHub.tick(DT_MS, i + 1);
      tickGhostRecording(GHOST_SAMPLE_INTERVAL, { ...pose, px: i * 0.37, pz: -i * 1.3 });
    }
    const payload = getCurrentGhostPayload()!;
    // 3000 × 15 floats × 4 B = 180 KB raw (+8 B header) → ~240 KB base64.
    expect(payload.length).toBe(Math.ceil((GHOST_MAX_SAMPLES * GHOST_BYTES_PER_SAMPLE + 8) / 3) * 4);
    expect(payload.length).toBeLessThan(350_000);
    expect(decodeGhostFromBase64(payload)?.sampleCount).toBe(GHOST_MAX_SAMPLES);
    inputHub.reset();
  });
});

