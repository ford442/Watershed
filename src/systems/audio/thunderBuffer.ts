/**
 * thunderBuffer.ts — one synthesized thunder clap for storm lightning (#464).
 *
 * There is no thunder asset and this adds none: a short crack (bright,
 * fast-decaying noise) on a long, rolling, heavily reddened rumble whose level
 * swells and fades over a few seconds. Played as a one-shot through
 * `AudioManager.playThunder` — Three.js `Audio`, no second audio library.
 *
 * Pure Float32Array math (same shape as speedWindBuffer.ts) so it can be
 * unit-tested without an AudioContext.
 */

/** Clap length — long enough for the roll to die away under the bed. */
export const THUNDER_SECONDS = 4.5;

/** Deterministic 32-bit LCG; a fixed seed keeps CI output byte-stable. */
function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Sample count for one clap at a given rate. */
export function thunderLength(sampleRate: number): number {
  return Math.max(1, Math.floor(sampleRate * THUNDER_SECONDS));
}

/**
 * Fill one channel with a thunder clap, peak-normalized to ~0.95, ending in
 * silence (the last samples fade to zero so a one-shot never clicks off).
 */
export function fillThunderChannel(out: Float32Array, sampleRate: number, seed = 0x7d0e): void {
  const n = out.length;
  if (n === 0 || !(sampleRate > 0)) return;
  const rng = makeRng(seed);

  // Rumble: two cascaded one-pole lowpasses (~60 Hz) over white noise.
  const rumbleK = Math.exp((-2 * Math.PI * 60) / sampleRate);
  // Crack: a lighter lowpass (~1.8 kHz) so it reads as a tear, not hiss.
  const crackK = Math.exp((-2 * Math.PI * 1800) / sampleRate);
  // A few rolling swells across the clap, fixed per seed.
  const rolls = [0.35 + rng() * 0.3, 0.9 + rng() * 0.5, 1.7 + rng() * 0.8];

  let lp1 = 0;
  let lp2 = 0;
  let crackLp = 0;
  const fadeOut = Math.max(1, Math.floor(sampleRate * 0.25));
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const white = rng() * 2 - 1;

    lp1 = lp1 * rumbleK + white * (1 - rumbleK);
    lp2 = lp2 * rumbleK + lp1 * (1 - rumbleK);
    let swell = 0;
    for (let r = 0; r < rolls.length; r += 1) {
      const d = (t - rolls[r]) / 0.45;
      swell += Math.exp(-d * d) * (1 - r * 0.22);
    }
    const attack = Math.min(1, t / 0.04);
    const rumble = lp2 * 40 * attack * (0.35 + swell) * Math.exp(-t / 2.2);

    crackLp = crackLp * crackK + white * (1 - crackK);
    const crack = crackLp * 2.5 * Math.exp(-t / 0.09);

    const tail = i >= n - fadeOut ? (n - 1 - i) / fadeOut : 1;
    out[i] = (rumble + crack) * tail;
  }

  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1e-6) {
    const scale = 0.95 / peak;
    for (let i = 0; i < n; i += 1) out[i] *= scale;
  }
}
