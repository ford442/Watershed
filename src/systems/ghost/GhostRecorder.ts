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
  type RunSplitEntry,
} from './ghostCodec';
import { setRunGhostData, updatePBGhost } from '../persistence/PersistenceSystem';

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

/**
 * Elapsed run time, in ms, derived from the sample clock — the same clock
 * driving playback (getGhostDurationSec). Accurate to one sample interval
 * (100 ms at 10 Hz); recording freezes on wipeout/pause (see
 * useExperienceLifecycle's tickGhostRecording gate), so this is stable once a
 * run ends without needing a separate wall-clock timer.
 */
export function getGhostElapsedMs(): number {
  return Math.round(writeIndex * (1000 / GHOST_SAMPLE_HZ));
}

/** Base64 payload of the buffer recorded so far, without touching persistence. */
export function getCurrentGhostPayload(): string | null {
  if (writeIndex <= 0) return null;
  return encodeGhostToBase64(encodeGhostBuffer(buffer, writeIndex));
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

/** Delta-encode the current buffer and persist as base64 on the run key.
 * @param runKey Persistence key for this map + seed.
 * @param runTimeMs Completion time in ms; when provided, only persists if this beats the existing PB.
 *                  Omit (or pass undefined) to always persist (legacy behaviour).
 * @param splits Checkpoint splits for this run. Only used (and only replaces the
 *               stored PB splits) when `runTimeMs` is provided and beats the PB.
 * @returns Whether the ghost was written — always true for the legacy (no
 *          runTimeMs) path, and only true when `runTimeMs` beat the PB otherwise.
 */
export function persistGhostRecording(
  runKey: string,
  runTimeMs?: number,
  splits?: RunSplitEntry[],
): boolean {
  if (writeIndex <= 0) return false;

  const encoded = encodeGhostBuffer(buffer, writeIndex);
  const payload = encodeGhostToBase64(encoded);

  if (runTimeMs !== undefined) {
    return updatePBGhost(runKey, runTimeMs, payload, splits);
  }
  setRunGhostData(runKey, payload);
  return true;
}
