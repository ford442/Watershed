/**
 * GhostRecorder.ts — 10 Hz ring-buffer recording for best-run ghost replay.
 */

import {
  encodeGhostBuffer,
  encodeGhostToBase64,
  GHOST_FLOATS_PER_SAMPLE,
  GHOST_SAMPLE_HZ,
  GHOST_SAMPLE_INTERVAL,
  type GhostSample,
} from './ghostCodec';
import { setRunGhostData } from './PersistenceSystem';

export { GHOST_SAMPLE_HZ, GHOST_SAMPLE_INTERVAL };
export const GHOST_MAX_SAMPLES = 3000; // ~5 minutes at 10 Hz

let buffer = new Float32Array(GHOST_MAX_SAMPLES * GHOST_FLOATS_PER_SAMPLE);
let writeIndex = 0;
let sampleAccum = 0;
let recording = false;

export function startGhostRecording(): void {
  writeIndex = 0;
  sampleAccum = 0;
  recording = true;
}

export function stopGhostRecording(): void {
  recording = false;
}

export function resetGhostRecording(): void {
  stopGhostRecording();
  writeIndex = 0;
  sampleAccum = 0;
}

export function isGhostRecording(): boolean {
  return recording;
}

export function getGhostSampleCount(): number {
  return writeIndex;
}

function writeSample(sample: GhostSample): void {
  if (writeIndex >= GHOST_MAX_SAMPLES) return;

  const offset = writeIndex * GHOST_FLOATS_PER_SAMPLE;
  buffer[offset] = sample.px;
  buffer[offset + 1] = sample.py;
  buffer[offset + 2] = sample.pz;
  buffer[offset + 3] = sample.qx;
  buffer[offset + 4] = sample.qy;
  buffer[offset + 5] = sample.qz;
  buffer[offset + 6] = sample.qw;
  writeIndex += 1;
}

/** Call from useFrame — never from Zustand subscribers. */
export function tickGhostRecording(delta: number, sample: GhostSample): void {
  if (!recording || delta <= 0) return;

  sampleAccum += delta;
  while (sampleAccum >= GHOST_SAMPLE_INTERVAL) {
    sampleAccum -= GHOST_SAMPLE_INTERVAL;
    writeSample(sample);
    if (writeIndex >= GHOST_MAX_SAMPLES) {
      recording = false;
      break;
    }
  }
}

/** Delta-encode the current buffer and persist as base64 on the run key. */
export function persistGhostRecording(runKey: string): void {
  if (writeIndex <= 0) return;

  const encoded = encodeGhostBuffer(buffer, writeIndex);
  const payload = encodeGhostToBase64(encoded);
  setRunGhostData(runKey, payload);
}
