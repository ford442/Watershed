/**
 * speedWindBuffer.ts — synthesized wind bed for the speed layer.
 *
 * The speed wind used to loop `ambient_wind`, which meant the velocity bed and
 * the biome ambience were literally the same buffer: raising one raised the
 * other's masking, and the lowpass sweep chewed on material that already had a
 * gust shape baked in. This generates a distinct, seamless, gust-shaped noise
 * bed instead — no new asset to ship and no second audio library (Three.js
 * `AudioLoader` / Web Audio only).
 *
 * Pure Float32Array math so the loop can be unit-tested without an AudioContext.
 */

/** Loop length. Long enough that the gust cycle is not obviously periodic. */
export const SPEED_WIND_LOOP_SECONDS = 4;

/** Equal-power crossfade length as a fraction of the loop, for a seamless wrap. */
const CROSSFADE_FRACTION = 0.12;

/** One-pole coefficient — reddens white noise toward a wind-like spectrum. */
const REDDEN = 0.86;

/** Deterministic 32-bit LCG; a fixed seed keeps CI output byte-stable. */
function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Slow gust envelope. Every partial completes a whole number of cycles per
 * loop, so the envelope itself is already continuous across the wrap and only
 * the noise needs crossfading.
 */
function gustEnvelope(phase: number): number {
  const gust =
    Math.sin(phase * Math.PI * 2) * 0.35 +
    Math.sin(phase * Math.PI * 2 * 3 + 1.1) * 0.18 +
    Math.sin(phase * Math.PI * 2 * 7 + 2.7) * 0.09;
  return 0.55 + gust * 0.45;
}

/**
 * Fill one channel with a seamless gusting wind loop, peak-normalized to ~0.9.
 *
 * `out.length` is the loop length; the last `CROSSFADE_FRACTION` of it is
 * equal-power blended with an extra tail so `sample[0]` follows `sample[n-1]`
 * without a click. The gust shape is loop-relative, so the generator needs no
 * sample rate — only `speedWindLoopLength` does.
 */
export function fillSpeedWindChannel(out: Float32Array, seed = 0x5eed): void {
  const n = out.length;
  if (n === 0) return;

  const fade = Math.min(Math.floor(n * CROSSFADE_FRACTION), Math.floor(n / 2));
  const total = n + fade;
  const rng = makeRng(seed);

  // Generate n + fade samples of reddened noise under the gust envelope.
  const raw = new Float32Array(total);
  let lp = 0;
  for (let i = 0; i < total; i += 1) {
    const white = rng() * 2 - 1;
    lp = lp * REDDEN + white * (1 - REDDEN);
    // Re-add a little of the white noise so the top octave does not vanish.
    raw[i] = (lp * 3.2 + white * 0.25) * gustEnvelope((i % n) / n);
  }

  // Equal-power crossfade of the tail back over the head.
  for (let i = 0; i < n; i += 1) out[i] = raw[i];
  for (let i = 0; i < fade; i += 1) {
    const t = fade > 1 ? i / (fade - 1) : 1;
    const headGain = Math.sin((t * Math.PI) / 2);
    const tailGain = Math.cos((t * Math.PI) / 2);
    out[i] = out[i] * headGain + raw[n + i] * tailGain;
  }

  // Peak-normalize; the mixer owns the actual level.
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1e-6) {
    const scale = 0.9 / peak;
    for (let i = 0; i < n; i += 1) out[i] *= scale;
  }
}

/** Sample count for the loop at a given rate. */
export function speedWindLoopLength(sampleRate: number): number {
  return Math.max(1, Math.floor(sampleRate * SPEED_WIND_LOOP_SECONDS));
}
