import { describe, expect, it } from 'vitest';
import {
  decodeGhost,
  decodeGhostFromBase64,
  encodeGhostSamples,
  encodeGhostToBase64,
  GHOST_FLOATS_PER_SAMPLE,
  type GhostSample,
} from './ghostCodec';

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
    expect(decoded?.samples[7]).toBeCloseTo(SAMPLE_B.px, 5);
  });

  it('rejects malformed float lengths', () => {
    expect(decodeGhost(new Float32Array([1, 2, 3]))).toBeNull();
  });
});
