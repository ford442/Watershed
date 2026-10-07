/**
 * nativeParticles — the splash / waterfall integrate on this session's one
 * `watershed_native` (sim/nativeOwner.ts), or on nothing.
 *
 * - worker: the sim worker's module (PARTICLES_*). One frame late: a step
 *   posted on frame N is applied on frame N+1, and a particle waiting on its
 *   step is not also integrated in JS.
 * - main: the main-thread module, synchronous (`?simWorker=0` / demoted).
 * - none (`wgsl`, or no module): the factories return null and the callers
 *   keep their JS integrate (#390 fallback).
 *
 * Spawn stays TS (particles.h). Particles beyond the native capacity always
 * take the JS integrate, so a burst larger than the SoA never freezes.
 */
import type { NativeOwner } from '../../sim/nativeOwner';
import { createSimParticleChannel, type SimParticleChannel } from '../../sim/simParticles';
import { heapF32, type WatershedNativeModule } from '../water/WatershedWasm';
import type { VFXParticle } from './ParticlePool';

/** Cached heap views over one particle-SoA allocation (px…maxLife planes). */
export interface SplashSoAViews {
  px?: Float32Array;
  py?: Float32Array;
  pz?: Float32Array;
  vx?: Float32Array;
  vy?: Float32Array;
  vz?: Float32Array;
  life?: Float32Array;
  maxLife?: Float32Array;
}

export interface SplashWasmSlot {
  mod: WatershedNativeModule;
  ptr: number;
  cap: number;
  views: SplashSoAViews;
}

/**
 * Rebind (or reuse) the eight `Float32Array` views over a splash/mist SoA
 * allocation via `heapF32()` (#415/#419 remainder): a grown `HEAPF32.buffer`
 * forces a rebuild, but an unchanged heap reuses the same views instead of
 * allocating eight typed arrays every frame.
 */
export function bindSplashViews(slot: SplashWasmSlot): Required<SplashSoAViews> {
  const { mod, ptr, cap, views } = slot;
  views.px = heapF32(mod, ptr, cap, views.px);
  views.py = heapF32(mod, ptr + cap * 4, cap, views.py);
  views.pz = heapF32(mod, ptr + cap * 8, cap, views.pz);
  views.vx = heapF32(mod, ptr + cap * 12, cap, views.vx);
  views.vy = heapF32(mod, ptr + cap * 16, cap, views.vy);
  views.vz = heapF32(mod, ptr + cap * 20, cap, views.vz);
  views.life = heapF32(mod, ptr + cap * 24, cap, views.life);
  views.maxLife = heapF32(mod, ptr + cap * 28, cap, views.maxLife);
  return views as Required<SplashSoAViews>;
}

/** Cached px/py/pz/scale heap views over one waterfall particle-SoA allocation. */
export interface WaterfallSoAViews {
  px?: Float32Array;
  py?: Float32Array;
  pz?: Float32Array;
  scale?: Float32Array;
}

/**
 * Rebind (or reuse) the four waterfall views via `heapF32()`. Callers must
 * reset `views` to `{}` whenever `base` changes, since heapF32 only detects a
 * *grown* buffer, not a different pointer into the same one.
 */
export function bindWaterfallViews(
  mod: WatershedNativeModule,
  base: number,
  capacity: number,
  views: WaterfallSoAViews,
): Required<WaterfallSoAViews> {
  views.px = heapF32(mod, base, capacity, views.px);
  views.py = heapF32(mod, base + capacity * 4, capacity, views.py);
  views.pz = heapF32(mod, base + capacity * 8, capacity, views.pz);
  views.scale = heapF32(mod, base + 8 * capacity * 4, capacity, views.scale);
  return views as Required<WaterfallSoAViews>;
}

// ── Splash / mist ────────────────────────────────────────────────────────────

export interface SplashIntegrator {
  readonly kind: 'worker' | 'main';
  /**
   * Advance `particles` (a copy of the pool's active list) by `dt`. Particles
   * the native step does not take go through `jsUpdate`; any that die are
   * handed to `release`.
   */
  integrate(
    particles: readonly VFXParticle[],
    dt: number,
    gravityY: number,
    damp: number,
    jsUpdate: (p: VFXParticle) => boolean,
    release: (p: VFXParticle) => void,
  ): void;
  dispose(): void;
}

function jsIntegrate(
  particles: readonly VFXParticle[],
  from: number,
  jsUpdate: (p: VFXParticle) => boolean,
  release: (p: VFXParticle) => void,
) {
  for (let i = from; i < particles.length; i += 1) {
    if (!jsUpdate(particles[i])) release(particles[i]);
  }
}

function createMainSplashIntegrator(mod: WatershedNativeModule, cap: number): SplashIntegrator {
  const slot: SplashWasmSlot = { mod, ptr: mod.allocateParticleSoA(cap), cap, views: {} };
  return {
    kind: 'main',
    integrate(particles, dt, gravityY, damp, jsUpdate, release) {
      const n = Math.min(particles.length, cap);
      if (n > 0 && slot.ptr) {
        // heapF32() rebinds only when ALLOW_MEMORY_GROWTH replaced the
        // ArrayBuffer (#415); an unchanged heap reuses the cached views.
        const { px, py, pz, vx, vy, vz, life, maxLife } = bindSplashViews(slot);
        for (let i = 0; i < n; i += 1) {
          const p = particles[i];
          px[i] = p.position.x;
          py[i] = p.position.y;
          pz[i] = p.position.z;
          vx[i] = p.velocity.x;
          vy[i] = p.velocity.y;
          vz[i] = p.velocity.z;
          life[i] = p.life;
          maxLife[i] = p.maxLife;
        }
        mod.stepSplashParticles(slot.ptr, cap, n, dt, gravityY, damp);
        for (let i = 0; i < n; i += 1) {
          const p = particles[i];
          p.position.set(px[i], py[i], pz[i]);
          p.velocity.set(vx[i], vy[i], vz[i]);
          p.life = life[i];
          p.rotation += p.rotationSpeed * dt;
          if (life[i] < 0) release(p);
        }
      }
      jsIntegrate(particles, slot.ptr ? n : 0, jsUpdate, release);
    },
    dispose() {
      if (slot.ptr) mod.freeParticleSoA(slot.ptr);
      slot.ptr = 0;
    },
  };
}

interface SplashSnapshot {
  refs: VFXParticle[];
  generations: number[];
  dt: number;
}

function createWorkerSplashIntegrator(channel: SimParticleChannel, cap: number): SplashIntegrator {
  const waiting = new Set<VFXParticle>();
  let snapshot: SplashSnapshot | null = null;

  const land = (release: (p: VFXParticle) => void) => {
    const result = channel.drain();
    if (!result || !snapshot) return;
    const n = result.count;
    const wire = new Float32Array(result.buffer, 0, n * 8);
    const { refs, generations, dt } = snapshot;
    for (let i = 0; i < n; i += 1) {
      const p = refs[i];
      // Released (and maybe re-spawned) while its step was in flight: drop it.
      if (!p.active || p.generation !== generations[i]) continue;
      p.position.set(wire[i], wire[n + i], wire[2 * n + i]);
      p.velocity.set(wire[3 * n + i], wire[4 * n + i], wire[5 * n + i]);
      p.life = wire[6 * n + i];
      p.rotation += p.rotationSpeed * dt;
      if (p.life < 0) release(p);
    }
    channel.recycle(result.buffer);
    waiting.clear();
    snapshot = null;
  };

  return {
    kind: 'worker',
    integrate(particles, dt, gravityY, damp, jsUpdate, release) {
      land(release);
      if (!channel.alive) {
        // Died with a step in flight: those particles resume in JS.
        waiting.clear();
        snapshot = null;
      }
      const send = channel.alive && !channel.busy;
      const refs: VFXParticle[] = [];
      for (const p of particles) {
        if (!p.active || waiting.has(p)) continue;
        if (send && refs.length < cap) refs.push(p);
        else if (!jsUpdate(p)) release(p);
      }
      if (refs.length === 0) return;
      const n = refs.length;
      const wire = channel.splashBuffer(n);
      for (let i = 0; i < n; i += 1) {
        const p = refs[i];
        wire[i] = p.position.x;
        wire[n + i] = p.position.y;
        wire[2 * n + i] = p.position.z;
        wire[3 * n + i] = p.velocity.x;
        wire[4 * n + i] = p.velocity.y;
        wire[5 * n + i] = p.velocity.z;
        wire[6 * n + i] = p.life;
        wire[7 * n + i] = p.maxLife;
      }
      if (channel.stepSplash(wire, n, dt, gravityY, damp)) {
        snapshot = { refs, generations: refs.map((p) => p.generation), dt };
        for (const p of refs) waiting.add(p);
      } else {
        jsIntegrate(refs, 0, jsUpdate, release);
      }
    },
    dispose() {
      waiting.clear();
      snapshot = null;
      channel.dispose();
    },
  };
}

/** Null when the session has no module (`wgsl`, or load failed): integrate in JS. */
export function createSplashIntegrator(owner: NativeOwner, capacity: number): SplashIntegrator | null {
  if (capacity <= 0) return null;
  switch (owner.kind) {
    case 'worker':
      return createWorkerSplashIntegrator(createSimParticleChannel(owner.proxy, capacity), capacity);
    case 'main':
      return createMainSplashIntegrator(owner.wasm, capacity);
    default:
      return null;
  }
}

// ── Waterfall ────────────────────────────────────────────────────────────────

export interface WaterfallChute {
  width: number;
  height: number;
  depthZ: number;
  fanSpreadRad: number;
  seed: number;
}

export interface WaterfallIntegrator {
  readonly kind: 'worker' | 'main';
  /** False once the sim worker died: the caller takes its JS pool from then on. */
  readonly alive: boolean;
  /**
   * Step `active` particles by `dt` and `write` each one's position and
   * scale. Returns how many were written, or -1 when nothing new landed this
   * frame (keep the previous instance matrices).
   */
  step(
    active: number,
    dt: number,
    write: (i: number, x: number, y: number, z: number, scale: number) => void,
  ): number;
  dispose(): void;
}

function createMainWaterfallIntegrator(
  mod: WatershedNativeModule,
  cap: number,
  chute: WaterfallChute,
): WaterfallIntegrator {
  const ptr = mod.allocateParticleSoA(cap);
  let seed = mod.initWaterfallParticles(
    ptr, cap, cap, chute.width, chute.height, chute.depthZ, chute.fanSpreadRad, chute.seed,
  );
  // Fresh pointer — never reuse views from another allocation.
  const views: WaterfallSoAViews = {};
  return {
    kind: 'main',
    alive: true,
    step(active, dt, write) {
      const n = Math.max(0, Math.min(active, cap));
      seed = mod.stepWaterfallParticles(ptr, cap, n, dt, chute.width, chute.height, chute.depthZ, seed);
      const { px, py, pz, scale } = bindWaterfallViews(mod, ptr, cap, views);
      for (let i = 0; i < n; i += 1) write(i, px[i], py[i], pz[i], scale[i]);
      return n;
    },
    dispose() {
      mod.freeParticleSoA(ptr);
    },
  };
}

function createWorkerWaterfallIntegrator(
  channel: SimParticleChannel,
  cap: number,
  chute: WaterfallChute,
): WaterfallIntegrator {
  channel.initWaterfall(cap, chute.width, chute.height, chute.depthZ, chute.fanSpreadRad, chute.seed);
  // Time a busy worker could not take yet rides on the next step.
  let pendingDt = 0;
  return {
    kind: 'worker',
    get alive() {
      return channel.alive;
    },
    step(active, dt, write) {
      const result = channel.drain();
      let written = -1;
      if (result) {
        const n = result.count;
        const wire = new Float32Array(result.buffer, 0, n * 4);
        for (let i = 0; i < n; i += 1) write(i, wire[i], wire[n + i], wire[2 * n + i], wire[3 * n + i]);
        channel.recycle(result.buffer);
        written = n;
      }
      pendingDt += dt;
      if (channel.stepWaterfall(Math.min(active, cap), pendingDt, chute.width, chute.height, chute.depthZ)) {
        pendingDt = 0;
      }
      return written;
    },
    dispose() {
      channel.dispose();
    },
  };
}

/** Null when the session has no module (`wgsl`, or load failed): integrate in JS. */
export function createWaterfallIntegrator(
  owner: NativeOwner,
  capacity: number,
  chute: WaterfallChute,
): WaterfallIntegrator | null {
  switch (owner.kind) {
    case 'worker':
      return createWorkerWaterfallIntegrator(createSimParticleChannel(owner.proxy, capacity), capacity, chute);
    case 'main':
      return createMainWaterfallIntegrator(owner.wasm, capacity, chute);
    default:
      return null;
  }
}
