/**
 * speedWindDsp.ts — streaming speed-wind + close-water grain synthesizer.
 *
 * The AudioWorklet body (worklets/speedWind.worklet.ts) and its tests share
 * this class, so what CI measures is what the audio thread runs. It is the
 * streaming counterpart of `speedWindBuffer.ts` (same reddened-noise recipe,
 * same gust partials, same level), with three things a pre-baked loop can't do:
 *
 *   - **no loop**: the gust partials are detuned from the 4 s loop's harmonics,
 *     so the bed never repeats;
 *   - **per-sample parameters**: speed → gain/brightness (`mapSpeedToWind`),
 *     the wetness muffle (`wetnessMuffleParams`) and wall tightness are applied
 *     on the audio thread, smoothed per block, instead of the render loop
 *     scheduling gain and filter automation every frame;
 *   - **close gurgle**: a Minnaert bubble-grain voice pool (the same model
 *     scripts/generate-sounds.mjs uses for the water beds) at a rate the main
 *     thread sets from flow turbulence.
 *
 * Gain contract: output = (wind · speedGain + gurgle · gurgleLevel) · wetGain,
 * lowpassed at the wetness cutoff. The node that carries it applies only the
 * mix constant × SFX channel (not `getEffectiveSfxGain()`, which would apply
 * the wetness gain a second time).
 *
 * Nothing is allocated per sample: `process()` runs ~375×/s on the audio
 * thread, and the only per-block garbage is the two small result objects from
 * the shared curve functions.
 */

import { DEFAULT_SPEED_WIND, mapSpeedToWind, type SpeedWindOptions } from './speedWind';
import { wetnessMuffleParams } from './wetnessMuffle';

export interface SpeedWindFrameParams {
  /** Horizontal speed (m/s). */
  speed: number;
  /** `SurvivalModifiers.sfxWetnessMultiplier` (1 dry … 0.65 soaked). */
  wetness: number;
  /** Canyon wall tightness 0–1 (0 when acoustics are off). */
  wallTightness: number;
  /** Close-water grain amount 0–1. */
  gurgle: number;
}

export interface SpeedWindDspOptions extends SpeedWindOptions {
  /** Gain/cutoff smoothing rate (1/s) — same meaning as AUDIO_CONFIG.wind.crossfadeSpeed. */
  crossfadeSpeed?: number;
  /** Gurgle level at gurgle = 1, relative to full-speed wind. */
  gurgleLevel?: number;
  seedLeft?: number;
  seedRight?: number;
}

/** Matches speedWindBuffer's reddening so the two paths share a timbre. */
const REDDEN = 0.86;
/**
 * Fixed level for the streaming noise. speedWindBuffer peak-normalizes a 4 s
 * loop to 0.9; for this recipe that lands the loop at ≈0.6 × raw, so the two
 * paths match in loudness (speedWindDsp.test.ts checks the RMS agreement).
 */
const NOISE_SCALE = 0.6;
/** Detuned from 0.25 / 0.75 / 1.75 Hz (the 4 s loop's partials). */
const GUST_HZ = [0.25, 0.77, 1.71];
const GUST_DEPTH = [0.35, 0.18, 0.09];
/** Boxy wall resonance for tight canyons. */
const WALL_RES_HZ = 620;
const MAX_BUBBLES = 24;
/** Bubbles/second at gurgle = 1. */
const GURGLE_RATE = 48;
const GURGLE_SCALE = 0.55;

type Rng = () => number;

function makeRng(seed: number): Rng {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** TPT state-variable filter, one channel, coefficients set per block. */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = 1.414;
  lp = 0;
  bp = 0;

  constructor(private readonly sampleRate: number) {}

  set(freq: number, q: number): void {
    const f = Math.min(Math.max(freq, 10), this.sampleRate * 0.45);
    const g = Math.tan((Math.PI * f) / this.sampleRate);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  tick(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
    this.lp = 0;
    this.bp = 0;
  }
}

class WindChannel {
  red = 0;
  readonly gustPhase: Float64Array;
  readonly tone: Svf;
  readonly wall: Svf;
  readonly muffle: Svf;

  constructor(readonly rng: Rng, sampleRate: number, phaseSeed: number) {
    this.gustPhase = Float64Array.from(GUST_HZ, (_, k) => (phaseSeed * (k + 1) * 1.618) % (Math.PI * 2));
    this.tone = new Svf(sampleRate);
    this.wall = new Svf(sampleRate);
    this.muffle = new Svf(sampleRate);
  }

  reset(): void {
    this.red = 0;
    this.tone.reset();
    this.wall.reset();
    this.muffle.reset();
  }
}

export class SpeedWindSynth {
  private readonly sampleRate: number;
  private readonly opts: Required<Omit<SpeedWindDspOptions, 'seedLeft' | 'seedRight'>>;
  private readonly left: WindChannel;
  private readonly right: WindChannel;
  private readonly gustInc: Float64Array;

  // Smoothed control state (per block).
  private gain = 0;
  private cutoff: number;
  private wetGain = 1;
  private wetCutoff = 20000;
  private tightness = 0;
  private gurgle = 0;

  // Bubble voice pool (struct-of-arrays, preallocated).
  private readonly bActive = new Uint8Array(MAX_BUBBLES);
  private readonly bPhase = new Float64Array(MAX_BUBBLES);
  private readonly bFreq = new Float64Array(MAX_BUBBLES);
  private readonly bChirp = new Float64Array(MAX_BUBBLES);
  private readonly bEnv = new Float64Array(MAX_BUBBLES);
  private readonly bDecay = new Float64Array(MAX_BUBBLES);
  private readonly bPanL = new Float64Array(MAX_BUBBLES);
  private readonly bPanR = new Float64Array(MAX_BUBBLES);
  private readonly bubbleRng: Rng;
  private untilNextBubble = 0;

  constructor(sampleRate: number, options: SpeedWindDspOptions = {}) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 48000;
    this.opts = {
      startSpeed: options.startSpeed ?? DEFAULT_SPEED_WIND.startSpeed,
      fullSpeed: options.fullSpeed ?? DEFAULT_SPEED_WIND.fullSpeed,
      cutoffAtRest: options.cutoffAtRest ?? DEFAULT_SPEED_WIND.cutoffAtRest,
      cutoffAtFull: options.cutoffAtFull ?? DEFAULT_SPEED_WIND.cutoffAtFull,
      crossfadeSpeed: options.crossfadeSpeed ?? 3.2,
      gurgleLevel: options.gurgleLevel ?? 0.35,
    };
    this.cutoff = this.opts.cutoffAtRest;
    const seedL = options.seedLeft ?? 0x5eed;
    const seedR = options.seedRight ?? 0xb1a5;
    this.left = new WindChannel(makeRng(seedL), this.sampleRate, 0.3);
    this.right = new WindChannel(makeRng(seedR), this.sampleRate, 2.1);
    this.bubbleRng = makeRng(seedL ^ seedR ^ 0x9e3779b9);
    this.gustInc = Float64Array.from(GUST_HZ, (hz) => (Math.PI * 2 * hz) / this.sampleRate);
  }

  /** Run reset: silence the bed and drop all state back to rest. */
  reset(): void {
    this.gain = 0;
    this.cutoff = this.opts.cutoffAtRest;
    this.gurgle = 0;
    this.left.reset();
    this.right.reset();
    this.bActive.fill(0);
  }

  /** Current smoothed speed gain 0–1 (diagnostics / tests). */
  get speedGain(): number {
    return this.gain;
  }

  /**
   * Render one block. `outR` may be omitted for a mono destination, in which
   * case the left channel is written alone.
   */
  process(outL: Float32Array, outR: Float32Array | undefined, params: SpeedWindFrameParams): void {
    const n = outL.length;
    if (n === 0) return;

    // --- block-rate control: targets, then one-pole smoothing ----------------
    const mapped = mapSpeedToWind(Math.max(0, finiteOr(params.speed, 0)), this.opts);
    const muffle = wetnessMuffleParams(finiteOr(params.wetness, 1));
    const alpha = 1 - Math.exp((-n * this.opts.crossfadeSpeed) / this.sampleRate);

    const g0 = this.gain;
    const w0 = this.wetGain;
    const u0 = this.gurgle;
    this.gain += (mapped.gain - this.gain) * alpha;
    this.cutoff += (mapped.cutoffHz - this.cutoff) * alpha;
    this.wetGain += (muffle.gain - this.wetGain) * alpha;
    this.wetCutoff += (muffle.cutoffHz - this.wetCutoff) * alpha;
    this.tightness += (clamp01(finiteOr(params.wallTightness, 0)) - this.tightness) * alpha;
    this.gurgle += (clamp01(finiteOr(params.gurgle, 0)) - this.gurgle) * alpha;

    const tight = this.tightness;
    const wallQ = 1.2 + 2.5 * tight;
    this.setChannelFilters(this.left, wallQ);
    this.setChannelFilters(this.right, wallQ);
    const wallMix = 0.35 * tight;
    // Tight walls narrow the image: the rush folds toward the centre.
    const width = 1 - 0.55 * tight;
    const gurgleLevel = this.opts.gurgleLevel * GURGLE_SCALE;
    const bubbleRate = this.gurgle * GURGLE_RATE;

    // --- sample loop ----------------------------------------------------------
    const invN = 1 / n;
    for (let i = 0; i < n; i += 1) {
      const t = (i + 1) * invN;
      const windGain = g0 + (this.gain - g0) * t;
      const wetGain = w0 + (this.wetGain - w0) * t;
      const gurgleGain = (u0 + (this.gurgle - u0) * t) * gurgleLevel;

      const l = this.windSample(this.left, wallMix) * windGain;
      const r = this.windSample(this.right, wallMix) * windGain;

      // Mid/side width.
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5 * width;
      let outLeft = mid + side;
      let outRight = mid - side;

      if (bubbleRate > 0.01 || this.anyBubble()) {
        this.maybeSpawnBubble(bubbleRate);
        this.tickBubbles();
        outLeft += this.bubbleL * gurgleGain;
        outRight += this.bubbleR * gurgleGain;
      }

      this.left.muffle.tick(outLeft * wetGain);
      this.right.muffle.tick(outRight * wetGain);
      outLeft = this.left.muffle.lp;
      outRight = this.right.muffle.lp;

      outL[i] = outLeft > 1 ? 1 : outLeft < -1 ? -1 : outLeft;
      if (outR) outR[i] = outRight > 1 ? 1 : outRight < -1 ? -1 : outRight;
    }
  }

  private setChannelFilters(ch: WindChannel, wallQ: number): void {
    ch.tone.set(this.cutoff, 0.7);
    ch.wall.set(WALL_RES_HZ, wallQ);
    ch.muffle.set(this.wetCutoff, 0.5);
  }

  private windSample(ch: WindChannel, wallMix: number): number {
    const white = ch.rng() * 2 - 1;
    ch.red = ch.red * REDDEN + white * (1 - REDDEN);

    let gust = 0;
    for (let k = 0; k < GUST_HZ.length; k += 1) {
      ch.gustPhase[k] += this.gustInc[k];
      if (ch.gustPhase[k] > Math.PI * 2) ch.gustPhase[k] -= Math.PI * 2;
      gust += Math.sin(ch.gustPhase[k]) * GUST_DEPTH[k];
    }
    const envelope = 0.55 + gust * 0.45;
    const raw = (ch.red * 3.2 + white * 0.25) * envelope * NOISE_SCALE;

    ch.tone.tick(raw);
    ch.wall.tick(ch.tone.lp);
    // Bandpass gain at centre is Q; normalise so wallMix is a true blend.
    return ch.tone.lp + (ch.wall.bp / (1.2 + 2.5 * this.tightness)) * wallMix;
  }

  // --- bubble grain -----------------------------------------------------------
  private bubbleL = 0;
  private bubbleR = 0;

  private anyBubble(): boolean {
    for (let b = 0; b < MAX_BUBBLES; b += 1) if (this.bActive[b]) return true;
    return false;
  }

  private maybeSpawnBubble(rate: number): void {
    if (rate <= 0.01) return;
    this.untilNextBubble -= 1;
    if (this.untilNextBubble > 0) return;
    const rng = this.bubbleRng;
    // Exponential inter-arrival → Poisson stream at `rate`.
    this.untilNextBubble = Math.max(1, Math.round((-Math.log(1 - rng()) / rate) * this.sampleRate));

    let slot = -1;
    for (let b = 0; b < MAX_BUBBLES; b += 1) {
      if (!this.bActive[b]) { slot = b; break; }
    }
    if (slot < 0) return; // pool full — drop, never allocate

    // Minnaert pitch, skewed small (high); van den Doel damping.
    const f0 = 280 * Math.pow(1500 / 280, Math.pow(rng(), 0.7));
    const damping = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5);
    const pan = rng();
    this.bActive[slot] = 1;
    this.bPhase[slot] = 0;
    this.bFreq[slot] = f0;
    this.bChirp[slot] = 1 + (0.1 * damping) / this.sampleRate; // rising pitch as it surfaces
    this.bEnv[slot] = (0.35 + 0.65 * rng()) * Math.pow(280 / f0, 0.35);
    this.bDecay[slot] = Math.exp(-damping / this.sampleRate);
    this.bPanL[slot] = Math.cos(pan * Math.PI * 0.5);
    this.bPanR[slot] = Math.sin(pan * Math.PI * 0.5);
  }

  private tickBubbles(): void {
    let l = 0;
    let r = 0;
    const twoPiOverSr = (Math.PI * 2) / this.sampleRate;
    for (let b = 0; b < MAX_BUBBLES; b += 1) {
      if (!this.bActive[b]) continue;
      this.bFreq[b] *= this.bChirp[b];
      this.bPhase[b] += this.bFreq[b] * twoPiOverSr;
      const s = Math.sin(this.bPhase[b]) * this.bEnv[b];
      l += s * this.bPanL[b];
      r += s * this.bPanR[b];
      this.bEnv[b] *= this.bDecay[b];
      if (this.bEnv[b] < 1e-4) this.bActive[b] = 0;
    }
    this.bubbleL = l;
    this.bubbleR = r;
  }
}

// ---------------------------------------------------------------------------
// Worklet contract — shared by the processor and the main-thread node factory.
// ---------------------------------------------------------------------------

export const SPEED_WIND_PROCESSOR = 'watershed-speed-wind';

export type SpeedWindParamName = keyof SpeedWindFrameParams;

/** AudioParam descriptors (k-rate: the synth smooths per block itself). */
export const SPEED_WIND_PARAM_DESCRIPTORS: ReadonlyArray<{
  name: SpeedWindParamName;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  automationRate: 'k-rate';
}> = [
  { name: 'speed', defaultValue: 0, minValue: 0, maxValue: 500, automationRate: 'k-rate' },
  { name: 'wetness', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  { name: 'wallTightness', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  { name: 'gurgle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
];

/** Messages the main thread posts to the processor's port. */
export type SpeedWindMessage = { type: 'reset' } | { type: 'dispose' };
