/**
 * WaterForceSystem × window scroll — the frame wiring, on the real component.
 *
 * The pure pieces (advanceSweWindow, scrollField) and the solver-side kernels
 * have their own tests. This one mounts WaterForceSystem, captures its
 * `useFrame` callback and drives it with a moving vehicle, to pin what only the
 * component can get wrong: the order of a frame (scroll → bed refresh → step),
 * that the height texture is re-uploaded on a scroll frame even when no step is
 * due, and that texture data and window origin always describe the same world.
 * The wasm module is a heap stub whose scroll is the TypeScript twin.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import * as THREE from 'three';
import type { WatershedNativeModule } from './WatershedWasm';
import { scrollField } from './sweScroll';

const h = vi.hoisted(() => ({
  frame: null as null | ((state: { clock: { elapsedTime: number } }, delta: number) => void),
  calls: [] as string[],
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: typeof h.frame) => {
    h.frame = cb;
  },
}));

vi.mock('../GameState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../GameState')>()),
  useQualityPreset: () => 'high',
}));

vi.mock('../../rendering/gpuChores', () => ({
  bindChoreWasm: vi.fn(),
  bindHeightfieldChoreWorker: vi.fn(),
  runHeightfieldChores: vi.fn(),
}));

vi.mock('./bathymetrySampler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bathymetrySampler')>()),
  // The rasterizer: stamp a marker so the frame order shows in the call log.
  sampleBathymetryInto: vi.fn((out: Float32Array, originX: number, originZ: number, _cell: number, w: number, hh: number) => {
    h.calls.push(`bed(${originX},${originZ})`);
    out.fill(0.25);
    return w * hh;
  }),
}));

vi.mock('./WatershedWasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./WatershedWasm')>()),
  getWasm: vi.fn(),
}));

import { getWasm } from './WatershedWasm';
import { getSWEHeightFieldSnapshot } from './SWEHeightField';
import { SWE_BUDGETS } from './sweQuality';
import { WaterForceSystem } from './WaterForceSystem';

const BUDGET = SWE_BUDGETS.high; // 48 x 32 at 0.5 m
const COUNT = BUDGET.width * BUDGET.height;

/** Heap-backed stand-in for the native module; scroll is the TS twin. */
function stubModule() {
  const heap = new Float32Array(1 << 18);
  let next = 16;
  const ptrs: number[] = [];
  const view = (ptr: number) => new Float32Array(heap.buffer, ptr, COUNT);
  const mod = {
    HEAPF32: heap,
    getVersion: () => 9,
    allocateGrid: (count: number) => {
      const ptr = next * 4;
      next += count;
      ptrs.push(ptr);
      return ptr;
    },
    freeGrid: () => {},
    stepShallowWater: vi.fn(() => {
      h.calls.push('step');
    }),
    applySWEEvent: vi.fn(),
    scrollShallowWater: vi.fn(
      (hp: number, up: number, wp: number, bp: number, width: number, height: number, sx: number, sz: number, eta: number, u: number, w: number) => {
        h.calls.push(`scroll(${sx},${sz})`);
        scrollField(
          { h: view(hp), u: view(up), w: view(wp), b: bp ? view(bp) : null },
          width, height, sx, sz, { eta, u, w },
        );
      },
    ),
    calculateWaterForce: vi.fn(() => ({
      forceX: 0, forceY: 0, forceZ: 0, buoyancy: 0, drag: 0, flow: 0, turbulence: 0, submergedRatio: 0,
    })),
  };
  return { mod: mod as unknown as WatershedNativeModule & typeof mod, view, ptrs };
}

/** A vehicle the test steers; the component reads `translation()` each frame. */
function vehicle() {
  const pos = { x: 0, y: 1, z: 0 };
  const ref = {
    current: {
      translation: () => pos,
      linvel: () => ({ x: 0, y: 0, z: 0 }),
      applyImpulse: vi.fn(),
    },
  };
  return { pos, ref };
}

const STEP = 1 / 30; // one SWE step is due this frame
const NO_STEP = 0.004; // well under the 60 Hz interval: no step this frame

let clock = 0;
function frame(delta: number) {
  clock += delta;
  act(() => {
    h.frame!({ clock: { elapsedTime: clock } }, delta);
  });
}

async function mount() {
  const stub = stubModule();
  vi.mocked(getWasm).mockResolvedValue(stub.mod);
  const v = vehicle();
  await act(async () => {
    render(<WaterForceSystem vehicleRef={v.ref as never} />);
    await Promise.resolve();
  });
  return { ...stub, ...v };
}

/** Peak η of the uploaded height texture, as a world position via the snapshot origin. */
function texturePeak() {
  const snap = getSWEHeightFieldSnapshot();
  const data = (snap.texture as THREE.DataTexture).image.data as unknown as Float32Array;
  let best = -Infinity;
  let idx = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] > best) {
      best = data[i];
      idx = i;
    }
  }
  return {
    x: snap.originX + (idx % snap.width) * snap.cellSize,
    z: snap.originZ + Math.floor(idx / snap.width) * snap.cellSize,
    eta: best,
  };
}

describe('WaterForceSystem window scroll', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.frame = null;
    clock = 0;
  });

  it('scrolls before the bed refresh and the step, with the header sign', async () => {
    const { mod, pos } = await mount();
    frame(STEP); // seeds the window: bed refresh + first step, no scroll
    expect(mod.scrollShallowWater).not.toHaveBeenCalled();
    h.calls.length = 0;

    pos.z -= 2; // 2 m downstream = 4 cells at 0.5 m, in one frame
    frame(STEP);

    expect(h.calls).toHaveLength(3);
    expect(h.calls[0]).toBe('scroll(0,4)'); // downstream (−Z) → positive shiftZ
    expect(h.calls[1]).toMatch(/^bed\(/);
    expect(h.calls[2]).toBe('step');
  });

  it('does not scroll or re-rasterize for sub-cell motion', async () => {
    const { mod, pos } = await mount();
    frame(STEP);
    h.calls.length = 0;
    for (const dz of [-0.1, -0.2, 0.1, -0.3, 0.2]) {
      pos.x = 0.1;
      pos.z = dz;
      frame(STEP);
    }
    expect(mod.scrollShallowWater).not.toHaveBeenCalled();
    expect(h.calls.filter((c) => c.startsWith('bed('))).toHaveLength(0);
    expect(h.calls.filter((c) => c === 'step')).toHaveLength(5);
  });

  it('keeps a splash on its world cell in the uploaded texture, on step and no-step frames alike', async () => {
    const { pos, view, ptrs } = await mount();
    frame(STEP);

    // A splash 6 m off the window's downstream edge... placed in the heap field
    // at world coordinates the snapshot's origin defines.
    const snap0 = getSWEHeightFieldSnapshot();
    const bump = { x: snap0.originX + 24 * BUDGET.cellSize, z: snap0.originZ + 4 * BUDGET.cellSize };
    const hField = view(ptrs[0]);
    for (let j = 0; j < BUDGET.height; j += 1) {
      for (let i = 0; i < BUDGET.width; i += 1) {
        const dx = snap0.originX + i * BUDGET.cellSize - bump.x;
        const dz = snap0.originZ + j * BUDGET.cellSize - bump.z;
        hField[j * BUDGET.width + i] = 0.4 * Math.exp(-(dx * dx + dz * dz) / 2);
      }
    }
    frame(STEP); // the stub solver does not move it; the upload shows it
    expect(texturePeak()).toMatchObject({ x: bump.x, z: bump.z });

    // 30 frames, 0.2 m downstream + 0.05 m sideways each: 12 cells of window
    // travel, alternating frames that take a SWE step and frames that don't.
    let scrolls = 0;
    for (let f = 1; f <= 30; f += 1) {
      pos.z -= 0.2;
      pos.x += 0.05;
      const before = h.calls.length;
      frame(f % 2 === 0 ? STEP : NO_STEP);
      scrolls += h.calls.slice(before).filter((c) => c.startsWith('scroll(')).length;

      const peak = texturePeak();
      const snap = getSWEHeightFieldSnapshot();
      // Data and origin describe the same world: the splash has not moved...
      expect(peak.x, `frame ${f} x`).toBe(bump.x);
      expect(peak.z, `frame ${f} z`).toBe(bump.z);
      expect(peak.eta, `frame ${f} η`).toBeCloseTo(0.4, 5);
      // ...and the window origin is what the component reports and sits on the lattice.
      const reported = (window as unknown as { __watershedWaterForceSystem: { origin: { x: number; z: number } } })
        .__watershedWaterForceSystem.origin;
      expect(snap.originX).toBe(reported.x);
      expect(snap.originZ).toBe(reported.z);
      expect(snap.originX / BUDGET.cellSize).toBe(Math.round(snap.originX / BUDGET.cellSize));
    }
    expect(scrolls).toBeGreaterThanOrEqual(10);
  });

  it('uploads the (u, w, depth, div) surface field with the height texture, reusing one texture', async () => {
    const { view, ptrs } = await mount();
    frame(STEP);
    const first = getSWEHeightFieldSnapshot();
    const flow = first.flowTexture as THREE.DataTexture;
    expect(flow).toBeTruthy();
    expect(flow.format).toBe(THREE.RGBAFormat);
    expect(flow.type).toBe(THREE.FloatType);
    expect(flow.image.width).toBe(BUDGET.width);
    expect(flow.image.height).toBe(BUDGET.height);

    // Plant a velocity bump at cell (10, 7): u = 1.5 m/s, w = -0.75 m/s.
    const cell = 7 * BUDGET.width + 10;
    view(ptrs[1])[cell] = 1.5;
    view(ptrs[2])[cell] = -0.75;
    frame(STEP);

    const snap = getSWEHeightFieldSnapshot();
    const data = (snap.flowTexture as THREE.DataTexture).image.data as unknown as Float32Array;
    expect(data[cell * 4]).toBeCloseTo(1.5);
    expect(data[cell * 4 + 1]).toBeCloseTo(-0.75);
    // The mocked bed is 0.25 m under a still surface: depth = mean 1.0 - 0.25.
    expect(data[cell * 4 + 2]).toBeCloseTo(0.75);

    // Same grid, same fieldVersion: one upload each, one texture instance for the session.
    expect(snap.flowTexture).toBe(flow);
    for (let f = 0; f < 5; f += 1) {
      frame(f % 2 === 0 ? STEP : NO_STEP);
      const s = getSWEHeightFieldSnapshot();
      expect(s.flowTexture).toBe(flow);
      expect((s.flowTexture as THREE.DataTexture).image.data).toBe(data);
      expect((s.flowTexture as THREE.DataTexture).version).toBe((s.texture as THREE.DataTexture).version);
    }
  });

  it('restarts the field at rest on a respawn-sized jump instead of smearing it', async () => {
    const { pos, view, ptrs } = await mount();
    frame(STEP);
    view(ptrs[0]).fill(0.3);
    pos.x = 400;
    pos.z = -900;
    frame(STEP);
    expect(h.calls.some((c) => /^scroll\((-?\d+),(-?\d+)\)$/.test(c))).toBe(true);
    const snap = getSWEHeightFieldSnapshot();
    const data = (snap.texture as THREE.DataTexture).image.data as unknown as Float32Array;
    expect(Array.from(data).every((v) => v === 0)).toBe(true);
    expect(snap.originX).toBeGreaterThan(300);
  });

  it('survives a non-finite anchor for a frame without poisoning the window', async () => {
    const { mod, pos } = await mount();
    frame(STEP);
    pos.z = Number.NaN;
    frame(STEP);
    expect(mod.scrollShallowWater).not.toHaveBeenCalled();
    pos.z = -2;
    frame(STEP);
    // Relative to the last valid window, not to NaN.
    expect(mod.scrollShallowWater).toHaveBeenLastCalledWith(
      expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number),
      BUDGET.width, BUDGET.height, 0, 4, 0, 0, 0,
    );
    const snap = getSWEHeightFieldSnapshot();
    expect(Number.isFinite(snap.originX) && Number.isFinite(snap.originZ)).toBe(true);
  });
});
