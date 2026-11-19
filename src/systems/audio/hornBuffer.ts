/**
 * hornBuffer.ts — the dam's warning horn, synthesized (#578 A.2).
 *
 * Two long, low blasts: the sound a spillway makes before its gates open. A
 * buzzy fundamental (a band-limited sawtooth: the first harmonics of ~92 Hz,
 * falling off as 1/n) with a slow, slight vibrato, each blast with a soft
 * attack and release so it never clicks. No asset, like the thunder clap: it is
 * rendered once per manager into an AudioBuffer (`createHornBuffer`) and played
 * as a one-shot through `AudioManager.playSynthOneShot('dam_horn', …)`. Only the
 * hazard telegraph's chunk imports it.
 *
 * Pure Float32Array math so it can be unit-tested without an AudioContext.
 */

/** Two blasts and the gap between them. */
export const HORN_SECONDS = 3.4;
const BLASTS: ReadonlyArray<readonly [number, number]> = [
  [0, 1.4],
  [1.85, 3.25],
];
const FUNDAMENTAL_HZ = 92;
const HARMONICS = 9;
const VIBRATO_HZ = 4.6;
/** Vibrato depth as a share of the pitch. */
const VIBRATO_DEPTH = 0.006;
const ATTACK_SECONDS = 0.12;
const RELEASE_SECONDS = 0.28;

/** Sample count for the horn at a given rate. */
export function hornLength(sampleRate: number): number {
  return Math.max(1, Math.floor(sampleRate * HORN_SECONDS));
}

/** Blast envelope at `t` seconds: 0 between blasts, a soft ramp at each edge. */
function blastGain(t: number): number {
  for (const [on, off] of BLASTS) {
    if (t < on || t > off) continue;
    const rise = Math.min(1, (t - on) / ATTACK_SECONDS);
    const fall = Math.min(1, (off - t) / RELEASE_SECONDS);
    return Math.min(rise, fall);
  }
  return 0;
}

/**
 * Fill one channel with the horn, peak-normalized to ~0.9, silent at both
 * ends. `detune` (a share of the pitch, ±) decorrelates two channels.
 */
export function fillHornChannel(out: Float32Array, sampleRate: number, detune = 0): void {
  const n = out.length;
  if (n === 0 || !(sampleRate > 0)) return;
  const pitch = FUNDAMENTAL_HZ * (1 + detune);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const gain = blastGain(t);
    const f = pitch * (1 + VIBRATO_DEPTH * Math.sin(2 * Math.PI * VIBRATO_HZ * t));
    phase += (2 * Math.PI * f) / sampleRate;
    if (gain === 0) {
      out[i] = 0;
      continue;
    }
    let v = 0;
    for (let h = 1; h <= HARMONICS; h += 1) v += Math.sin(phase * h) / h;
    out[i] = v * gain;
  }
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1e-6) {
    const scale = 0.9 / peak;
    for (let i = 0; i < n; i += 1) out[i] *= scale;
  }
}

/** The horn as a stereo AudioBuffer (channels detuned ±0.2 % so it is wide, not centred). */
export function createHornBuffer(context: BaseAudioContext): AudioBuffer {
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(2, hornLength(sampleRate), sampleRate);
  fillHornChannel(buffer.getChannelData(0), sampleRate, -0.002);
  fillHornChannel(buffer.getChannelData(1), sampleRate, 0.002);
  return buffer;
}
