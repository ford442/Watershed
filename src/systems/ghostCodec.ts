/**
 * ghostCodec.ts — Delta-encoded ghost trajectory compression for localStorage.
 *
 * Each sample is 7 floats: position (x,y,z) + quaternion (x,y,z,w).
 * First sample is absolute; subsequent samples store deltas from the previous.
 */

export const GHOST_FLOATS_PER_SAMPLE = 7;
export const GHOST_BYTES_PER_SAMPLE = GHOST_FLOATS_PER_SAMPLE * 4;
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
}

export interface DecodedGhost {
  samples: Float32Array;
  sampleCount: number;
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

/** Pack absolute samples into delta-encoded Float32Array. */
export function encodeGhostSamples(samples: GhostSample[]): Float32Array {
  if (samples.length === 0) return new Float32Array(0);

  const out = new Float32Array(samples.length * GHOST_FLOATS_PER_SAMPLE);
  let prev = samples[0];

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!isFiniteSample(sample)) continue;

    const offset = i * GHOST_FLOATS_PER_SAMPLE;
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
    prev = sample;
  }

  return out;
}

/** Pack a contiguous Float32Array ring buffer (sampleCount × 7 floats). */
export function encodeGhostBuffer(buffer: Float32Array, sampleCount: number): Float32Array {
  if (sampleCount <= 0) return new Float32Array(0);

  const samples: GhostSample[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const offset = i * GHOST_FLOATS_PER_SAMPLE;
    samples.push({
      px: buffer[offset],
      py: buffer[offset + 1],
      pz: buffer[offset + 2],
      qx: buffer[offset + 3],
      qy: buffer[offset + 4],
      qz: buffer[offset + 5],
      qw: buffer[offset + 6],
    });
  }
  return encodeGhostSamples(samples);
}

/** Decode delta-encoded floats back to absolute samples. */
export function decodeGhost(encoded: Float32Array): DecodedGhost | null {
  if (encoded.length === 0) return { samples: new Float32Array(0), sampleCount: 0 };
  if (encoded.length % GHOST_FLOATS_PER_SAMPLE !== 0) return null;

  const sampleCount = encoded.length / GHOST_FLOATS_PER_SAMPLE;
  const samples = new Float32Array(encoded.length);

  for (let i = 0; i < sampleCount; i += 1) {
    const src = i * GHOST_FLOATS_PER_SAMPLE;
    const dst = src;
    if (i === 0) {
      for (let j = 0; j < GHOST_FLOATS_PER_SAMPLE; j += 1) {
        samples[dst + j] = encoded[src + j];
      }
    } else {
      for (let j = 0; j < GHOST_FLOATS_PER_SAMPLE; j += 1) {
        samples[dst + j] = samples[dst + j - GHOST_FLOATS_PER_SAMPLE] + encoded[src + j];
      }
    }
  }

  return { samples, sampleCount };
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
