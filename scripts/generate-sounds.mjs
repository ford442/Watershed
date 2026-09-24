#!/usr/bin/env node
/**
 * generate-sounds.mjs — deterministic foley for `public/sounds/*.mp3`.
 *
 * The 23 files that shipped until now were six 1-second sine stubs
 * (BUILD_HYGIENE.md §6.3). This script replaces every one of them with a
 * distinct, physically-modelled payload:
 *
 *   - water: Minnaert bubble clouds (van den Doel damping + rising chirp) over
 *     shaped pink/brown noise — the standard procedural-liquid model;
 *   - impacts / footsteps: modal synthesis (inharmonic damped partials per
 *     material) + contact click + grit grains;
 *   - wind: resonant howl (moving high-Q bandpasses) — deliberately a
 *     different signal from the synthesized speed-wind bed
 *     (`src/systems/audio/speedWindBuffer.ts` / the worklet), which is
 *     broadband reddened noise under a lowpass sweep;
 *   - raft creak: stick-slip impulse train through wood resonators.
 *
 * Fixed seeds → byte-stable output, so re-running is a no-op in git unless a
 * recipe changes. Everything here is project-authored (no third-party
 * samples); see `public/sounds/README.md` for licensing.
 *
 * Filenames are unchanged so `SOUND_DEFS` URLs do not churn. The files are
 * unhashed passengers: deploy.py always uploads non-`assets/` paths, so a
 * same-size replacement can never be size-skipped.
 *
 * Usage:  node scripts/generate-sounds.mjs [--out public/sounds] [--only name,name]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mp3Encoder } from '@breezystack/lamejs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SR = 44100;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// DSP toolkit
// ---------------------------------------------------------------------------

/** Deterministic 32-bit LCG in [0, 1). */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const range = (rng, lo, hi) => lo + (hi - lo) * rng();
const samples = (sec) => Math.max(1, Math.round(sec * SR));

/** Paul Kellet's economy pink noise. */
function pinkNoise(n, rng) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i += 1) {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return out;
}

/** Leaky-integrated white noise (≈ -6 dB/oct). */
function brownNoise(n, rng) {
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    y = y * 0.995 + (rng() * 2 - 1) * 0.06;
    out[i] = y;
  }
  return out;
}

function whiteNoise(n, rng) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rng() * 2 - 1;
  return out;
}

/**
 * Topology-preserving state-variable filter (Zavalishin). Stable under fast
 * cutoff modulation, which the sweeps below rely on.
 */
class Svf {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.set(1000, 0.707); }
  set(freq, q) {
    const f = Math.min(Math.max(freq, 10), SR * 0.45);
    this.g = Math.tan((Math.PI * f) / SR);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  /** Returns [lp, bp, hp] for one sample (reuses a scratch array). */
  tick(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    SVF_OUT[0] = v2;
    SVF_OUT[1] = v1;
    SVF_OUT[2] = x - this.k * v1 - v2;
    return SVF_OUT;
  }
}
const SVF_OUT = [0, 0, 0];
const LP = 0, BP = 1, HP = 2;

/** Filter a buffer in place; `freqAt(i)` may modulate the cutoff. */
function filter(buf, mode, freqAt, q = 0.707) {
  const f = new Svf();
  const fixed = typeof freqAt === 'number';
  if (fixed) f.set(freqAt, q);
  for (let i = 0; i < buf.length; i += 1) {
    if (!fixed && (i & 15) === 0) f.set(freqAt(i), q);
    buf[i] = f.tick(buf[i])[mode];
  }
  return buf;
}

const lowpass = (b, fq, q) => filter(b, LP, fq, q);
const highpass = (b, fq, q) => filter(b, HP, fq, q);
const bandpass = (b, fq, q) => filter(b, BP, fq, q);

function mixInto(dst, src, gain = 1, offset = 0) {
  const n = Math.min(src.length, dst.length - offset);
  for (let i = 0; i < n; i += 1) dst[offset + i] += src[i] * gain;
  return dst;
}

/** Multiply by an envelope function of time (seconds). */
function shape(buf, envAt) {
  for (let i = 0; i < buf.length; i += 1) buf[i] *= envAt(i / SR);
  return buf;
}

/** Attack/exponential-decay envelope. */
const adEnv = (attack, decay) => (t) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / decay);

/**
 * A single cavitating bubble: Minnaert resonance with van den Doel damping and
 * the characteristic upward chirp as the bubble nears the surface.
 */
function addBubble(buf, t0, f0, amp, rise = 0.1) {
  const start = Math.floor(t0 * SR);
  if (start >= buf.length || start < 0) return;
  const d = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5);
  const len = Math.min(buf.length - start, Math.ceil((SR * 6.5) / d));
  let phase = 0;
  for (let i = 0; i < len; i += 1) {
    const t = i / SR;
    const f = f0 * (1 + rise * d * t);
    phase += (TAU * f) / SR;
    buf[start + i] += amp * Math.sin(phase) * Math.exp(-d * t);
  }
}

/**
 * Poisson bubble cloud. `rateAt(t)` is events/second; radius drawn so small
 * bubbles dominate (real streams are skewed toward high Minnaert pitches).
 */
function bubbleCloud(buf, rng, { rateAt, fLo, fHi, amp, rise = 0.1, tEnd }) {
  const end = tEnd ?? buf.length / SR;
  let t = 0;
  while (t < end) {
    const rate = Math.max(rateAt(t), 1e-3);
    t += -Math.log(1 - rng()) / rate;
    if (t >= end) break;
    // Log-uniform pitch skewed high; bigger (lower) bubbles are louder.
    const u = Math.pow(rng(), 0.7);
    const f0 = fLo * Math.pow(fHi / fLo, u);
    const a = amp * (0.35 + 0.65 * rng()) * Math.pow(fLo / f0, 0.35);
    addBubble(buf, t, f0, a, rise * (0.6 + rng() * 0.8));
  }
}

/** Damped sinusoidal mode (modal synthesis partial). */
function addMode(buf, t0, freq, decay, amp, phase = 0) {
  const start = Math.floor(t0 * SR);
  const len = Math.min(buf.length - start, Math.ceil(decay * SR * 7));
  for (let i = 0; i < len; i += 1) {
    const t = i / SR;
    buf[start + i] += amp * Math.sin(TAU * freq * t + phase) * Math.exp(-t / decay);
  }
}

/** Short broadband contact transient. */
function addClick(buf, rng, t0, dur, amp, hpHz = 2000) {
  const n = samples(dur);
  const c = highpass(whiteNoise(n, rng), hpHz);
  shape(c, (t) => Math.exp(-t / (dur / 4)));
  mixInto(buf, c, amp, Math.floor(t0 * SR));
}

/** Low body thump — pitch-dropping sine, like a mass hitting a floor. */
function addThump(buf, t0, f0, decay, amp, drop = 0.35) {
  const start = Math.floor(t0 * SR);
  const len = Math.min(buf.length - start, Math.ceil(decay * SR * 6));
  let phase = 0;
  for (let i = 0; i < len; i += 1) {
    const t = i / SR;
    const f = f0 * (1 - drop * (1 - Math.exp(-t / (decay * 0.6))));
    phase += (TAU * f) / SR;
    buf[start + i] += amp * Math.sin(phase) * Math.exp(-t / decay);
  }
}

/** Gravel / crunch: a burst of tiny bandpassed grains. */
function addGrains(buf, rng, { t0, span, count, fLo, fHi, amp, grainMs = 3 }) {
  for (let g = 0; g < count; g += 1) {
    const t = t0 + span * Math.pow(rng(), 1.6);
    const n = samples((grainMs * (0.5 + rng())) / 1000);
    const grain = bandpass(whiteNoise(n, rng), range(rng, fLo, fHi), 2.5);
    shape(grain, (tt) => Math.sin((Math.PI * tt * SR) / n));
    const decay = Math.exp(-(t - t0) / Math.max(span * 0.5, 1e-3));
    mixInto(buf, grain, amp * (0.3 + rng() * 0.7) * decay, Math.floor(t * SR));
  }
}

function fadeEdges(buf, inMs = 2, outMs = 20) {
  const a = Math.min(samples(inMs / 1000), buf.length);
  const b = Math.min(samples(outMs / 1000), buf.length);
  for (let i = 0; i < a; i += 1) buf[i] *= i / a;
  for (let i = 0; i < b; i += 1) buf[buf.length - 1 - i] *= i / b;
  return buf;
}

function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i += 1) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

function rms(buf) {
  let e = 0;
  for (let i = 0; i < buf.length; i += 1) e += buf[i] * buf[i];
  return Math.sqrt(e / Math.max(1, buf.length));
}

/** Gentle tanh limiter above `knee`, keeping the result under 1. */
function softLimit(buf, knee = 0.85) {
  const room = 1 - knee;
  for (let i = 0; i < buf.length; i += 1) {
    const x = buf[i];
    const ax = Math.abs(x);
    if (ax > knee) buf[i] = Math.sign(x) * (knee + room * Math.tanh((ax - knee) / room));
  }
  return buf;
}

function normalizePeak(chans, target) {
  const p = Math.max(...chans.map(peak));
  if (p > 1e-9) for (const c of chans) for (let i = 0; i < c.length; i += 1) c[i] *= target / p;
  return chans;
}

function normalizeRms(chans, target, knee = 0.8) {
  const r = Math.sqrt(chans.reduce((s, c) => s + rms(c) ** 2, 0) / chans.length);
  if (r > 1e-9) for (const c of chans) for (let i = 0; i < c.length; i += 1) c[i] *= target / r;
  for (const c of chans) softLimit(c, knee);
  return chans;
}

/**
 * Render `loopLen + fade` samples with `render(n)`, then equal-power crossfade
 * the tail over the head so the loop wraps without a seam. (The runtime also
 * re-seams after decode — `loopBuffer.ts` — because MP3 priming/padding would
 * otherwise put a gap at the wrap.)
 */
function loopify(loopSec, fadeSec, render) {
  const n = samples(loopSec);
  const f = samples(fadeSec);
  const raw = render(n + f);
  const out = raw.slice(0, n);
  for (let i = 0; i < f; i += 1) {
    const t = i / (f - 1);
    out[i] = out[i] * Math.sin((t * Math.PI) / 2) + raw[n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

/** Loop-periodic LFO: `cycles` whole periods per loop keep the wrap aligned. */
const lfo = (n, cycles, phase = 0) => (i) => Math.sin((TAU * cycles * (i % n)) / n + phase);

// ---------------------------------------------------------------------------
// Recipes — each returns { channels: Float32Array[], kbps }
// ---------------------------------------------------------------------------

function stereoBed(loopSec, fadeSec, seedL, seedR, renderChannel) {
  const n = samples(loopSec);
  return [seedL, seedR].map((seed) =>
    loopify(loopSec, fadeSec, (len) => renderChannel(len, n, makeRng(seed))),
  );
}

const RECIPES = {
  // ---- 1. water ------------------------------------------------------------
  rapids_roar() {
    const chans = stereoBed(6, 0.5, 0x7a91, 0x13c4, (len, n, rng) => {
      // Churning broadband body: pink noise, turbulent AM at non-harmonic rates.
      const body = highpass(lowpass(pinkNoise(len, rng), 3800, 0.6), 70);
      const am1 = lfo(n, 5), am2 = lfo(n, 13, 1.3), am3 = lfo(n, 31, 2.1);
      for (let i = 0; i < len; i += 1) {
        body[i] *= 0.72 + 0.14 * am1(i) + 0.08 * am2(i) + 0.06 * am3(i);
      }
      // Sub-bass rumble of mass moving over rock.
      const rumble = lowpass(brownNoise(len, rng), 140, 0.9);
      // Dense entrained-air bubble layer — the "white" in white water.
      const bubbles = new Float32Array(len);
      bubbleCloud(bubbles, rng, { rateAt: () => 420, fLo: 380, fHi: 3200, amp: 0.05, rise: 0.12 });
      // Spray hiss.
      const spray = highpass(whiteNoise(len, rng), 5200);
      const out = new Float32Array(len);
      mixInto(out, body, 1.0);
      mixInto(out, rumble, 0.9);
      mixInto(out, bubbles, 1.0);
      mixInto(out, spray, 0.035);
      return out;
    });
    return { channels: normalizeRms(chans, 0.2), kbps: 128 };
  },

  ambient_water() {
    const chans = stereoBed(6, 0.4, 0x2b3d, 0x9e01, (len, n, rng) => {
      // A small stream: sparse, clearly separate bubbles over a soft wash.
      const out = new Float32Array(len);
      const ripple = lfo(n, 3, 0.4);
      bubbleCloud(out, rng, {
        rateAt: (t) => 26 + 14 * ripple(Math.floor(t * SR)),
        fLo: 260, fHi: 1400, amp: 0.3, rise: 0.09,
      });
      const wash = bandpass(pinkNoise(len, rng), 1400, 0.45);
      mixInto(out, wash, 0.16);
      // Occasional trickle — tiny high bubbles in short runs.
      bubbleCloud(out, rng, { rateAt: () => 60, fLo: 1800, fHi: 4200, amp: 0.05, rise: 0.05 });
      return out;
    });
    return { channels: normalizeRms(chans, 0.12), kbps: 128 };
  },

  water_crash() {
    const len = samples(2.8);
    const rng = makeRng(0xc4a5);
    const out = new Float32Array(len);
    // Mass of water hitting the pool: low thump + broadband slam.
    addThump(out, 0, 72, 0.28, 0.9, 0.4);
    const slam = lowpass(pinkNoise(len, rng), (i) => 9000 * Math.exp(-i / (SR * 0.5)) + 700, 0.5);
    shape(slam, adEnv(0.006, 0.55));
    mixInto(out, slam, 1.4);
    // Bubble cloud collapsing over ~2 s.
    const cloud = new Float32Array(len);
    bubbleCloud(cloud, rng, {
      rateAt: (t) => 900 * Math.exp(-t / 0.6) + 20, fLo: 200, fHi: 2600, amp: 0.1, rise: 0.14,
    });
    mixInto(out, cloud, 1);
    // Spray falling back.
    const spray = highpass(whiteNoise(len, rng), 4000);
    shape(spray, (t) => (t < 0.15 ? t / 0.15 : Math.exp(-(t - 0.15) / 0.7)));
    mixInto(out, spray, 0.12);
    return { channels: normalizePeak([fadeEdges(out, 1, 120)], 0.89), kbps: 128 };
  },

  splash() {
    const len = samples(0.9);
    const rng = makeRng(0x5b1a);
    const out = new Float32Array(len);
    const burst = bandpass(whiteNoise(len, rng), (i) => 2600 - 1400 * Math.min(1, i / (SR * 0.2)), 0.7);
    shape(burst, adEnv(0.003, 0.09));
    mixInto(out, burst, 1.1);
    addThump(out, 0, 140, 0.05, 0.35, 0.3);
    bubbleCloud(out, rng, {
      rateAt: (t) => 260 * Math.exp(-t / 0.18), fLo: 450, fHi: 3000, amp: 0.2, rise: 0.12, tEnd: 0.6,
    });
    // Droplets landing back.
    for (let d = 0; d < 7; d += 1) {
      addBubble(out, 0.18 + rng() * 0.55, range(rng, 2200, 4200), 0.07 + rng() * 0.05, 0.2);
    }
    return { channels: normalizePeak([fadeEdges(out, 1, 60)], 0.89), kbps: 128 };
  },

  // ---- 2. biome wind / canyon ----------------------------------------------
  ambient_wind() {
    const chans = stereoBed(8, 0.6, 0x3a17, 0x6c2f, (len, n, rng) => {
      // Howl: two resonant bandpasses whose centres wander (loop-periodic), fed
      // by pink noise. Tonal and moaning — nothing like the broadband speed rush.
      const src = pinkNoise(len, rng);
      const howlA = bandpass(src.slice(), ((l) => (i) => 420 + 160 * l(i))(lfo(n, 2, rng() * 6)), 9);
      const howlB = bandpass(src.slice(), ((l) => (i) => 760 + 240 * l(i))(lfo(n, 3, rng() * 6)), 12);
      const gust = lfo(n, 1, rng() * 6), gust2 = lfo(n, 4, rng() * 6);
      const hiss = highpass(whiteNoise(len, rng), 2600);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i += 1) {
        const g = 0.55 + 0.3 * gust(i) + 0.15 * gust2(i);
        out[i] = howlA[i] * 1.6 * g + howlB[i] * 1.1 * g * g + hiss[i] * 0.03 * (0.4 + g);
      }
      return out;
    });
    return { channels: normalizeRms(chans, 0.1), kbps: 128 };
  },

  ambient_canyon() {
    const chans = stereoBed(8, 0.6, 0x88d2, 0x41e7, (len, n, rng) => {
      // Distant river filling a canyon: low, dark roar with a slow swell and a
      // faint airy room tone above it. Darker than rapids_roar by design.
      const roar = lowpass(brownNoise(len, rng), 420, 0.6);
      const swell = lfo(n, 1, rng() * 6), swell2 = lfo(n, 3, rng() * 6);
      for (let i = 0; i < len; i += 1) roar[i] *= 0.8 + 0.15 * swell(i) + 0.05 * swell2(i);
      const air = bandpass(pinkNoise(len, rng), 2200, 0.35);
      const far = new Float32Array(len);
      bubbleCloud(far, rng, { rateAt: () => 90, fLo: 300, fHi: 1400, amp: 0.05 });
      lowpass(far, 900, 0.5);
      const out = new Float32Array(len);
      mixInto(out, roar, 1);
      mixInto(out, air, 0.05);
      mixInto(out, far, 0.8);
      return out;
    });
    return { channels: normalizeRms(chans, 0.12), kbps: 128 };
  },

  // ---- 3. wall collisions (VehicleSystem surface map) ----------------------
  collide_rock() {
    const len = samples(0.6);
    const rng = makeRng(0x0c01);
    const out = new Float32Array(len);
    addClick(out, rng, 0, 0.006, 0.9, 1800);
    // Inharmonic stone partials, short and bright.
    [[830, 0.05], [1370, 0.035], [2160, 0.028], [3390, 0.02], [4870, 0.012]].forEach(([f, d], k) =>
      addMode(out, 0, f * range(rng, 0.97, 1.03), d, 0.34 / (k + 1) ** 0.5, rng() * TAU));
    addThump(out, 0, 115, 0.06, 0.55);
    addGrains(out, rng, { t0: 0.01, span: 0.25, count: 26, fLo: 2500, fHi: 7000, amp: 0.22 });
    return { channels: normalizePeak([fadeEdges(out, 0.5, 40)], 0.89), kbps: 128 };
  },

  collide_wood() {
    const len = samples(0.7);
    const rng = makeRng(0x0c02);
    const out = new Float32Array(len);
    addClick(out, rng, 0, 0.004, 0.45, 1200);
    // Hollow plank knock: low, well-separated modes with longer ring.
    [[176, 0.16], [412, 0.1], [688, 0.075], [1115, 0.05], [1660, 0.03]].forEach(([f, d], k) =>
      addMode(out, 0, f * range(rng, 0.98, 1.02), d, 0.5 / (k + 1) ** 0.7, rng() * TAU));
    addThump(out, 0, 95, 0.05, 0.35);
    return { channels: normalizePeak([fadeEdges(out, 0.5, 40)], 0.89), kbps: 128 };
  },

  collide_moss() {
    const len = samples(0.45);
    const rng = makeRng(0x0c03);
    const out = new Float32Array(len);
    // Soft, damped: nothing rings through a mat of wet moss.
    addThump(out, 0, 88, 0.07, 0.8, 0.3);
    const cushion = lowpass(whiteNoise(len, rng), 420, 0.6);
    shape(cushion, adEnv(0.008, 0.05));
    mixInto(out, cushion, 1.6);
    const squish = bandpass(whiteNoise(len, rng), 1500, 1.2);
    shape(squish, (t) => (t < 0.02 ? 0 : Math.exp(-(t - 0.02) / 0.04)));
    mixInto(out, squish, 0.28);
    bubbleCloud(out, rng, { rateAt: () => 60, fLo: 700, fHi: 1800, amp: 0.05, tEnd: 0.18 });
    return { channels: normalizePeak([fadeEdges(out, 1, 40)], 0.8), kbps: 128 };
  },

  collide_concrete() {
    const len = samples(0.6);
    const rng = makeRng(0x0c04);
    const out = new Float32Array(len);
    addClick(out, rng, 0, 0.005, 0.8, 1000);
    // Dense, dull modal field: many low-Q partials that die fast.
    for (let k = 0; k < 14; k += 1) {
      addMode(out, 0, range(rng, 240, 2600), range(rng, 0.012, 0.035), 0.12, rng() * TAU);
    }
    addThump(out, 0, 68, 0.09, 0.85, 0.4);
    addGrains(out, rng, { t0: 0.005, span: 0.14, count: 18, fLo: 1500, fHi: 4500, amp: 0.2 });
    return { channels: normalizePeak([fadeEdges(out, 0.5, 40)], 0.89), kbps: 128 };
  },

  // ---- 4. runner ------------------------------------------------------------
  footstep_rock() {
    const len = samples(0.28);
    const rng = makeRng(0xf001);
    const out = new Float32Array(len);
    addThump(out, 0, 105, 0.03, 0.5);
    addGrains(out, rng, { t0: 0.004, span: 0.05, count: 22, fLo: 2000, fHi: 6000, amp: 0.45 });
    addMode(out, 0.002, 1840, 0.012, 0.18);
    return { channels: normalizePeak([fadeEdges(out, 0.5, 20)], 0.85), kbps: 128 };
  },

  footstep_moss() {
    const len = samples(0.3);
    const rng = makeRng(0xf002);
    const out = new Float32Array(len);
    addThump(out, 0, 80, 0.04, 0.55, 0.25);
    const rustle = bandpass(whiteNoise(len, rng), (i) => 1400 + 900 * Math.sin(i / 900), 1.1);
    shape(rustle, (t) => (t < 0.015 ? t / 0.015 : Math.exp(-(t - 0.015) / 0.06)));
    mixInto(out, rustle, 0.55);
    return { channels: normalizePeak([fadeEdges(out, 1, 20)], 0.8), kbps: 128 };
  },

  footstep_wood() {
    const len = samples(0.3);
    const rng = makeRng(0xf003);
    const out = new Float32Array(len);
    addClick(out, rng, 0, 0.003, 0.35, 2500);
    [[218, 0.06], [522, 0.04], [985, 0.025]].forEach(([f, d], k) =>
      addMode(out, 0, f * range(rng, 0.98, 1.02), d, 0.45 / (k + 1), rng() * TAU));
    return { channels: normalizePeak([fadeEdges(out, 0.5, 20)], 0.85), kbps: 128 };
  },

  footstep_wet() {
    const len = samples(0.38);
    const rng = makeRng(0xf004);
    const out = new Float32Array(len);
    // Slap on a wet surface, then a squelch as the sole lifts.
    const slap = highpass(whiteNoise(len, rng), 900);
    shape(slap, adEnv(0.002, 0.018));
    mixInto(out, slap, 0.9);
    addThump(out, 0, 95, 0.035, 0.4);
    for (let b = 0; b < 6; b += 1) addBubble(out, 0.03 + rng() * 0.12, range(rng, 380, 1100), 0.22, 0.15);
    addBubble(out, 0.24 + rng() * 0.06, range(rng, 2600, 3600), 0.08, 0.25);
    return { channels: normalizePeak([fadeEdges(out, 0.5, 20)], 0.85), kbps: 128 };
  },

  jump() {
    const len = samples(0.4);
    const rng = makeRng(0x1a01);
    const out = new Float32Array(len);
    // Push-off scuff + body whoosh sweeping up.
    addGrains(out, rng, { t0: 0, span: 0.03, count: 10, fLo: 1800, fHi: 5000, amp: 0.3 });
    const whoosh = bandpass(pinkNoise(len, rng), (i) => 450 * Math.pow(4.5, Math.min(1, i / (SR * 0.3))), 1.6);
    shape(whoosh, (t) => Math.sin(Math.PI * Math.min(1, t / 0.32)) ** 2);
    mixInto(out, whoosh, 1.4);
    return { channels: normalizePeak([fadeEdges(out, 1, 20)], 0.8), kbps: 128 };
  },

  jump_double() {
    const len = samples(0.45);
    const rng = makeRng(0x1a02);
    const out = new Float32Array(len);
    // Mid-air kick: two quick, brighter swishes.
    [0, 0.09].forEach((t0, k) => {
      const n = samples(0.3);
      const sw = bandpass(pinkNoise(n, rng), (i) => (900 + k * 400) * Math.pow(4, Math.min(1, i / (SR * 0.2))), 2);
      shape(sw, (t) => Math.sin(Math.PI * Math.min(1, t / 0.22)) ** 2);
      mixInto(out, sw, k === 0 ? 1.2 : 1.5, samples(t0));
    });
    return { channels: normalizePeak([fadeEdges(out, 1, 20)], 0.8), kbps: 128 };
  },

  land_soft() {
    const len = samples(0.35);
    const rng = makeRng(0x1d01);
    const out = new Float32Array(len);
    addThump(out, 0, 100, 0.05, 0.7, 0.3);
    addGrains(out, rng, { t0: 0.003, span: 0.06, count: 12, fLo: 1500, fHi: 4500, amp: 0.2 });
    return { channels: normalizePeak([fadeEdges(out, 0.5, 20)], 0.8), kbps: 128 };
  },

  land_hard() {
    const len = samples(0.45);
    const rng = makeRng(0x1d02);
    const out = new Float32Array(len);
    addThump(out, 0, 74, 0.08, 1.0, 0.4);
    addClick(out, rng, 0, 0.005, 0.4, 1500);
    addGrains(out, rng, { t0: 0.003, span: 0.12, count: 28, fLo: 1500, fHi: 6000, amp: 0.3 });
    const cloth = bandpass(pinkNoise(len, rng), 1100, 0.9);
    shape(cloth, (t) => (t < 0.01 ? 0 : Math.exp(-(t - 0.01) / 0.05)));
    mixInto(out, cloth, 0.3);
    return { channels: normalizePeak([fadeEdges(out, 0.5, 30)], 0.89), kbps: 128 };
  },

  land_impact() {
    const len = samples(0.8);
    const rng = makeRng(0x1d03);
    const out = new Float32Array(len);
    addThump(out, 0, 52, 0.14, 1.0, 0.45);
    addThump(out, 0.035, 90, 0.06, 0.45, 0.3); // secondary body settle
    addClick(out, rng, 0, 0.008, 0.6, 900);
    addGrains(out, rng, { t0: 0.005, span: 0.35, count: 55, fLo: 1200, fHi: 6500, amp: 0.3 });
    bubbleCloud(out, rng, { rateAt: (t) => 120 * Math.exp(-t / 0.12), fLo: 400, fHi: 2200, amp: 0.1, tEnd: 0.4 });
    return { channels: normalizePeak([fadeEdges(out, 0.5, 60)], 0.89), kbps: 128 };
  },

  // ---- 5. raft ---------------------------------------------------------------
  paddle_left() { return paddleStroke(0x9a01, 1.0); },
  paddle_right() { return paddleStroke(0x9a02, 1.07); },

  raft_creak() {
    const len = samples(1.1);
    const rng = makeRng(0xc7ee);
    const exc = new Float32Array(len);
    // Stick-slip: irregular impulses whose rate glides up then back as load shifts.
    let t = 0.03;
    while (t < 0.95) {
      const p = t / 0.95;
      const rate = 70 + 90 * Math.sin(Math.PI * p) + range(rng, -12, 12);
      const i = samples(t);
      if (i < len) exc[i] += (0.6 + rng() * 0.4) * Math.sin(Math.PI * p) ** 0.6;
      t += 1 / rate;
    }
    const out = new Float32Array(len);
    [[310, 14], [740, 18], [1380, 22], [2250, 20]].forEach(([f, q], k) =>
      mixInto(out, bandpass(exc.slice(), f * range(rng, 0.97, 1.03), q), 1 / (k + 1) ** 0.4));
    mixInto(out, lowpass(exc.slice(), 180, 0.7), 0.4);
    return { channels: normalizePeak([fadeEdges(out, 2, 60)], 0.8), kbps: 128 };
  },

  // ---- 6. boost / UI ---------------------------------------------------------
  boost() {
    const len = samples(0.9);
    const rng = makeRng(0xb005);
    const out = new Float32Array(len);
    // Surge: rising filtered rush + a soft tonal lift + a burst of spray.
    const rush = bandpass(pinkNoise(len, rng), (i) => 300 * Math.pow(14, Math.min(1, i / (SR * 0.55))), 1.3);
    shape(rush, (t) => Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - 0.4) / 0.2));
    mixInto(out, rush, 1.4);
    let phase = 0;
    for (let i = 0; i < len; i += 1) {
      const tt = i / SR;
      phase += (TAU * (190 * Math.pow(3.2, Math.min(1, tt / 0.5)))) / SR;
      const env = Math.min(1, tt / 0.05) * Math.exp(-Math.max(0, tt - 0.35) / 0.15);
      out[i] += 0.12 * env * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
    }
    bubbleCloud(out, rng, { rateAt: (t) => 180 * Math.exp(-t / 0.25), fLo: 900, fHi: 3800, amp: 0.05, tEnd: 0.6 });
    return { channels: normalizePeak([fadeEdges(out, 1, 60)], 0.85), kbps: 128 };
  },
};

function paddleStroke(seed, pitch) {
  const len = samples(0.95);
  const rng = makeRng(seed);
  const out = new Float32Array(len);
  // Blade entry: a big low "plop" bubble and a soft thunk.
  addBubble(out, 0.0, 240 * pitch, 0.5, 0.18);
  addThump(out, 0, 130 * pitch, 0.03, 0.3);
  // Pull: water sheeting past the blade.
  const pull = lowpass(pinkNoise(len, rng), (i) => 700 + 900 * Math.sin(Math.PI * Math.min(1, i / (SR * 0.45))), 0.8);
  shape(pull, (t) => (t < 0.45 ? Math.sin((Math.PI * t) / 0.45) : 0) ** 1.5);
  mixInto(out, pull, 0.9);
  bubbleCloud(out, rng, {
    rateAt: (t) => (t < 0.45 ? 140 : 25), fLo: 350 * pitch, fHi: 1600 * pitch, amp: 0.12, tEnd: 0.6,
  });
  // Blade exit drips.
  for (let d = 0; d < 5; d += 1) addBubble(out, 0.5 + rng() * 0.35, range(rng, 1900, 3600), 0.08, 0.25);
  return { channels: normalizePeak([fadeEdges(out, 1, 40)], 0.85), kbps: 128 };
}

// ---------------------------------------------------------------------------
// MP3 output
// ---------------------------------------------------------------------------

function toInt16(buf) {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) {
    const x = Math.max(-1, Math.min(1, buf[i]));
    out[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
  }
  return out;
}

function encodeMp3(channels, kbps) {
  const enc = new Mp3Encoder(channels.length, SR, kbps);
  const pcm = channels.map(toInt16);
  const parts = [];
  const block = 1152;
  for (let i = 0; i < pcm[0].length; i += block) {
    const l = pcm[0].subarray(i, i + block);
    const chunk = channels.length > 1 ? enc.encodeBuffer(l, pcm[1].subarray(i, i + block)) : enc.encodeBuffer(l);
    if (chunk.length) parts.push(Buffer.from(chunk));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = path.resolve(REPO_ROOT, outIdx >= 0 ? args[outIdx + 1] : 'public/sounds');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, recipe] of Object.entries(RECIPES)) {
    if (only && !only.has(name)) continue;
    const { channels, kbps } = recipe();
    for (const c of channels) {
      for (let i = 0; i < c.length; i += 1) {
        if (!Number.isFinite(c[i])) throw new Error(`${name}: non-finite sample at ${i}`);
      }
    }
    const mp3 = encodeMp3(channels, kbps);
    fs.writeFileSync(path.join(outDir, `${name}.mp3`), mp3);
    const secs = (channels[0].length / SR).toFixed(2);
    console.log(`${name.padEnd(18)} ${String(channels.length).padStart(1)}ch ${secs.padStart(5)}s ${String(mp3.length).padStart(7)} B`);
  }
}

main();
