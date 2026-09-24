import { describe, expect, it } from 'vitest';
import { SpeedWindSynth, type SpeedWindFrameParams } from './speedWindDsp';
import { fillSpeedWindChannel, speedWindLoopLength } from './speedWindBuffer';

const SR = 48000;
const BLOCK = 128;

/** Render `seconds` of audio, returning the last `measure` seconds. */
function render(
  synth: SpeedWindSynth,
  params: Partial<SpeedWindFrameParams>,
  seconds: number,
  measure = seconds,
): { l: Float32Array; r: Float32Array } {
  const p: SpeedWindFrameParams = { speed: 0, wetness: 1, wallTightness: 0, gurgle: 0, ...params };
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const keep = Math.ceil((measure * SR) / BLOCK);
  const l = new Float32Array(keep * BLOCK);
  const r = new Float32Array(keep * BLOCK);
  const bl = new Float32Array(BLOCK);
  const br = new Float32Array(BLOCK);
  for (let b = 0; b < blocks; b += 1) {
    synth.process(bl, br, p);
    const k = b - (blocks - keep);
    if (k >= 0) {
      l.set(bl, k * BLOCK);
      r.set(br, k * BLOCK);
    }
  }
  return { l, r };
}

const rms = (a: Float32Array) => Math.sqrt(a.reduce((e, x) => e + x * x, 0) / Math.max(1, a.length));

describe('SpeedWindSynth', () => {
  it('is silent at rest and rises with speed', () => {
    const rest = rms(render(new SpeedWindSynth(SR), { speed: 0 }, 2, 1).l);
    const mid = rms(render(new SpeedWindSynth(SR), { speed: 15 }, 3, 1).l);
    const full = rms(render(new SpeedWindSynth(SR), { speed: 30 }, 3, 1).l);
    expect(rest).toBeLessThan(1e-4);
    expect(mid).toBeGreaterThan(0.01);
    expect(full).toBeGreaterThan(mid);
  });

  it('matches the pre-baked fallback loop in loudness at full speed', () => {
    // Fallback: the 4 s loop through the same speed gain (1 at full speed).
    const loop = new Float32Array(speedWindLoopLength(SR));
    fillSpeedWindChannel(loop, 0x5eed);
    const worklet = render(new SpeedWindSynth(SR, { cutoffAtFull: 20000 }), { speed: 40 }, 6, 4).l;
    const ratio = rms(worklet) / rms(loop);
    // Same recipe, different realisation: within ±35 %.
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(1.35);
  });

  it('ducks with wetness — gain follows sfxWetnessMultiplier, top end is muffled', () => {
    const dry = render(new SpeedWindSynth(SR), { speed: 15, wetness: 1 }, 4, 2).l;
    const soaked = render(new SpeedWindSynth(SR), { speed: 15, wetness: 0.65 }, 4, 2).l;
    // At least the 0.65 gain floor, plus the lowpass taking some energy.
    expect(rms(soaked)).toBeLessThan(rms(dry) * 0.7);
    expect(rms(soaked)).toBeGreaterThan(rms(dry) * 0.2);
  });

  it('tight walls narrow the stereo image', () => {
    const correlation = (a: Float32Array, b: Float32Array) => {
      let ab = 0, aa = 0, bb = 0;
      for (let i = 0; i < a.length; i += 1) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
      return ab / Math.sqrt(aa * bb);
    };
    const open = render(new SpeedWindSynth(SR), { speed: 20, wallTightness: 0 }, 3, 2);
    const slot = render(new SpeedWindSynth(SR), { speed: 20, wallTightness: 0.9 }, 3, 2);
    expect(correlation(slot.l, slot.r)).toBeGreaterThan(correlation(open.l, open.r) + 0.2);
  });

  it('gurgle adds close-water grain even when standing still', () => {
    const still = render(new SpeedWindSynth(SR), { speed: 0, gurgle: 0 }, 2, 1).l;
    const gurgling = render(new SpeedWindSynth(SR), { speed: 0, gurgle: 1 }, 3, 2).l;
    expect(rms(still)).toBeLessThan(1e-4);
    expect(rms(gurgling)).toBeGreaterThan(0.003);
  });

  it('never emits non-finite or out-of-range samples, even for garbage params', () => {
    const synth = new SpeedWindSynth(SR);
    const garbage = [
      { speed: Number.NaN, wetness: Number.NaN, wallTightness: Number.NaN, gurgle: Number.NaN },
      { speed: Number.POSITIVE_INFINITY, wetness: -5, wallTightness: 7, gurgle: 99 },
      { speed: -30, wetness: 0, wallTightness: -1, gurgle: -1 },
    ];
    for (const params of garbage) {
      const { l, r } = render(synth, params, 0.5);
      const bad = [...l, ...r].filter((x) => !Number.isFinite(x) || Math.abs(x) > 1);
      expect(bad).toEqual([]);
    }
  });

  it('reset() returns to silence immediately', () => {
    const synth = new SpeedWindSynth(SR);
    render(synth, { speed: 25 }, 2);
    expect(synth.speedGain).toBeGreaterThan(0.5);
    synth.reset();
    expect(synth.speedGain).toBe(0);
    const after = new Float32Array(BLOCK);
    synth.process(after, undefined, { speed: 0, wetness: 1, wallTightness: 0, gurgle: 0 });
    expect(rms(after)).toBeLessThan(1e-4);
  });

  it('writes mono when no right channel is given', () => {
    const synth = new SpeedWindSynth(SR);
    const out = new Float32Array(BLOCK);
    for (let b = 0; b < 400; b += 1) synth.process(out, undefined, { speed: 20, wetness: 1, wallTightness: 0, gurgle: 0 });
    expect(rms(out)).toBeGreaterThan(0);
  });
});
