/**
 * ghostCodec.ts — Delta-encoded ghost trajectory compression for localStorage.
 *
 * A sample is 15 floats: 7 pose — position (x,y,z) + quaternion (x,y,z,w),
 * delta-encoded (first sample absolute, the rest deltas from the previous) —
 * then 8 input floats, absolute: the InputHub's ghost latch for that 100 ms
 * window in the InputFrame layout (see src/input/InputFrame.ts), with PAUSE
 * masked out so a replay can never pause the viewer's game.
 *
 * A v4 payload opens with a 2-float header `[GHOST_V4_MAGIC, 4]`; anything
 * without it is a headerless v1–v3 payload (stride 7, poses only). Decoding
 * always yields stride-15 samples, the input slots of a v3 payload zero-filled,
 * so playback reads one layout whatever was stored.
 *
 * Codec version history (this is also the `.wsghost` file format version —
 * see ghostExport.ts):
 *   1 — Initial release: 7-float delta-encoded samples, base64 payload.
 *   2 — `.wsghost` gains an optional `splits[]` array (checkpoint times next
 *       to the pose payload). The 7-float pose encoding is unchanged, so a v1
 *       file is a valid v2 file with no splits — see importGhostFromJson's
 *       `codecVersion <= GHOST_CODEC_VERSION` acceptance rule.
 *   3 — optional launchHour / hydroEventHash / qualityPreset fairness fields.
 *   4 — #486 A: each sample carries the 8-float input track (stride 7 → 15),
 *       behind the v4 header. v1–v3 payloads still decode.
 */

import {
  createInputFrame,
  decodeInputFrame,
  encodeInputFrame,
  GHOST_BUTTON_MASK,
  INPUT_FRAME_FLOATS,
  type InputFrame,
} from '../../input/InputFrame';

export const GHOST_CODEC_VERSION = 4 as const;
/** Pose floats per sample (position + quaternion), delta-encoded. */
export const GHOST_POSE_FLOATS = 7;
/** Input floats per sample (InputFrame layout), absolute. */
export const GHOST_INPUT_FLOATS = INPUT_FRAME_FLOATS;
export const GHOST_FLOATS_PER_SAMPLE = GHOST_POSE_FLOATS + GHOST_INPUT_FLOATS;
export const GHOST_BYTES_PER_SAMPLE = GHOST_FLOATS_PER_SAMPLE * 4;
/** Stride of a headerless v1–v3 payload. */
export const GHOST_V3_FLOATS_PER_SAMPLE = GHOST_POSE_FLOATS;
/** −2^127: exact in float32, and no pose ever sits there, so it marks a v4 header. */
export const GHOST_V4_MAGIC = -(2 ** 127);
export const GHOST_V4_HEADER_FLOATS = 2;
export const GHOST_SAMPLE_HZ = 10;
export const GHOST_SAMPLE_INTERVAL = 1 / GHOST_SAMPLE_HZ;

export interface GhostSample {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Input latched over this sample's window. Absent → neutral input. */
  input?: Readonly<InputFrame>;
}

/** One authored-checkpoint split recorded during a timed run. */
export interface RunSplitEntry {
  /** Segment index the checkpoint belongs to (matches `segment-enter` detail). */
  segmentIndex: number;
  /** Elapsed run time at the checkpoint, in ms — same clock as the ghost recorder. */
  tMs: number;
  /** Vehicle speed at the checkpoint (m/s), for context in the results table. */
  speed: number;
}

export interface DecodedGhost {
  /** Absolute samples, GHOST_FLOATS_PER_SAMPLE floats each. */
  samples: Float32Array;
  sampleCount: number;
  /** Codec the payload was written with: 3 covers every headerless v1–v3 payload. */
  codecVersion: 3 | 4;
}

function isFiniteSample(sample: GhostSample): boolean {
  return (
    Number.isFinite(sample.px) &&
    Number.isFinite(sample.py) &&
    Number.isFinite(sample.pz) &&
    Number.isFinite(sample.qx) &&
    Number.isFinite(sample.qy) &&
    Number.isFinite(sample.qz) &&
    Number.isFinite(sample.qw)
  );
}

function writeHeader(out: Float32Array): void {
  out[0] = GHOST_V4_MAGIC;
  out[1] = GHOST_CODEC_VERSION;
}

/** Pack absolute samples into a v4 payload (pose delta-encoded, input absolute). */
export function encodeGhostSamples(samples: GhostSample[]): Float32Array {
  if (samples.length === 0) return new Float32Array(0);

  const out = new Float32Array(GHOST_V4_HEADER_FLOATS + samples.length * GHOST_FLOATS_PER_SAMPLE);
  writeHeader(out);
  let prev = samples[0];

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!isFiniteSample(sample)) continue;

    const offset = GHOST_V4_HEADER_FLOATS + i * GHOST_FLOATS_PER_SAMPLE;
    if (i === 0) {
      out[offset] = sample.px;
      out[offset + 1] = sample.py;
      out[offset + 2] = sample.pz;
      out[offset + 3] = sample.qx;
      out[offset + 4] = sample.qy;
      out[offset + 5] = sample.qz;
      out[offset + 6] = sample.qw;
    } else {
      out[offset] = sample.px - prev.px;
      out[offset + 1] = sample.py - prev.py;
      out[offset + 2] = sample.pz - prev.pz;
      out[offset + 3] = sample.qx - prev.qx;
      out[offset + 4] = sample.qy - prev.qy;
      out[offset + 5] = sample.qz - prev.qz;
      out[offset + 6] = sample.qw - prev.qw;
    }
    if (sample.input) {
      encodeInputFrame(sample.input, out, offset + GHOST_POSE_FLOATS, GHOST_BUTTON_MASK);
    }
    prev = sample;
  }

  return out;
}

/**
 * Pack the recorder's ring buffer (sampleCount × 15 absolute floats: pose then
 * input) into a v4 payload. Non-finite poses are skipped (left zero), as in
 * encodeGhostSamples.
 */
export function encodeGhostBuffer(buffer: Float32Array, sampleCount: number): Float32Array {
  if (sampleCount <= 0) return new Float32Array(0);

  const out = new Float32Array(GHOST_V4_HEADER_FLOATS + sampleCount * GHOST_FLOATS_PER_SAMPLE);
  writeHeader(out);
  let prevOffset = -1;
  for (let i = 0; i < sampleCount; i += 1) {
    const src = i * GHOST_FLOATS_PER_SAMPLE;
    let finite = true;
    for (let j = 0; j < GHOST_POSE_FLOATS; j += 1) {
      if (!Number.isFinite(buffer[src + j])) finite = false;
    }
    if (!finite) continue;

    const dst = GHOST_V4_HEADER_FLOATS + src;
    for (let j = 0; j < GHOST_POSE_FLOATS; j += 1) {
      out[dst + j] = i === 0 ? buffer[src + j] : buffer[src + j] - buffer[prevOffset + j];
    }
    for (let j = GHOST_POSE_FLOATS; j < GHOST_FLOATS_PER_SAMPLE; j += 1) {
      out[dst + j] = buffer[src + j];
    }
    // Ring-buffer writers already mask; re-mask so a payload never carries PAUSE.
    const b = dst + GHOST_POSE_FLOATS + 6;
    out[b] = Math.round(out[b]) & GHOST_BUTTON_MASK;
    prevOffset = src;
  }
  return out;
}

function hasV4Header(encoded: Float32Array): boolean {
  return (
    encoded.length >= GHOST_V4_HEADER_FLOATS &&
    encoded[0] === GHOST_V4_MAGIC &&
    encoded[1] === GHOST_CODEC_VERSION
  );
}

/** Decode a v4 payload, or a headerless v1–v3 one (input slots zero-filled). */
export function decodeGhost(encoded: Float32Array): DecodedGhost | null {
  if (encoded.length === 0) return { samples: new Float32Array(0), sampleCount: 0, codecVersion: GHOST_CODEC_VERSION };

  const v4 = hasV4Header(encoded);
  const base = v4 ? GHOST_V4_HEADER_FLOATS : 0;
  const stride = v4 ? GHOST_FLOATS_PER_SAMPLE : GHOST_V3_FLOATS_PER_SAMPLE;
  const body = encoded.length - base;
  if (body % stride !== 0) return null;

  const sampleCount = body / stride;
  const samples = new Float32Array(sampleCount * GHOST_FLOATS_PER_SAMPLE);

  for (let i = 0; i < sampleCount; i += 1) {
    const src = base + i * stride;
    const dst = i * GHOST_FLOATS_PER_SAMPLE;
    for (let j = 0; j < GHOST_POSE_FLOATS; j += 1) {
      samples[dst + j] = i === 0 ? encoded[src + j] : samples[dst + j - GHOST_FLOATS_PER_SAMPLE] + encoded[src + j];
    }
    if (v4) {
      for (let j = GHOST_POSE_FLOATS; j < GHOST_FLOATS_PER_SAMPLE; j += 1) {
        samples[dst + j] = encoded[src + j];
      }
    }
  }

  return { samples, sampleCount, codecVersion: v4 ? 4 : 3 };
}

/** Read sample `index`'s input track into `into` (neutral for a v3 ghost). */
export function readGhostInput(ghost: DecodedGhost, index: number, into: InputFrame = createInputFrame()): InputFrame {
  return decodeInputFrame(ghost.samples, index * GHOST_FLOATS_PER_SAMPLE + GHOST_POSE_FLOATS, into);
}

export function encodeGhostToBase64(encoded: Float32Array): string {
  const bytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodeGhostFromBase64(payload: string): DecodedGhost | null {
  if (!payload) return null;
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const floats = new Float32Array(bytes.buffer);
    return decodeGhost(floats);
  } catch {
    return null;
  }
}
