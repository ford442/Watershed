import { bindSplashViews, type SplashWasmSlot } from './SplashSystem';
import { bindWaterfallViews, type WaterfallSoAViews } from '../../components/Environment/WaterfallParticles';
import { PARTICLE_SOA_PLANES, type WatershedNativeModule } from './WatershedWasm';

/**
 * Mirrors physics/__tests__/physicsWorkerWaterForces.heap.test.ts: proves the
 * splash/mist and waterfall particle-SoA views (#415/#419 remainder) rebind
 * after ALLOW_MEMORY_GROWTH replaces HEAPF32.buffer, and are otherwise reused
 * rather than reallocated every frame.
 */
function mockMod(byteLength = 1024 * 1024): WatershedNativeModule {
  const buffer = new ArrayBuffer(byteLength);
  return {
    HEAPF32: new Float32Array(buffer),
    HEAP32: new Int32Array(buffer),
    HEAPU8: new Uint8Array(buffer),
    getVersion: () => 8,
  } as unknown as WatershedNativeModule;
}

describe('SplashSystem particle-SoA views', () => {
  it('reuses the same views across frames when the heap has not grown', () => {
    const mod = mockMod();
    const cap = 16;
    const slot: SplashWasmSlot = { mod, ptr: 4, cap, views: {} };

    const first = bindSplashViews(slot);
    const second = bindSplashViews(slot);

    expect(second.px).toBe(first.px);
    expect(second.py).toBe(first.py);
    expect(second.pz).toBe(first.pz);
    expect(second.vx).toBe(first.vx);
    expect(second.vy).toBe(first.vy);
    expect(second.vz).toBe(first.vz);
    expect(second.life).toBe(first.life);
    expect(second.maxLife).toBe(first.maxLife);
  });

  it('rebinds every view after HEAPF32.buffer grows', () => {
    const mod = mockMod();
    const cap = 16;
    const slot: SplashWasmSlot = { mod, ptr: 4, cap, views: {} };

    const before = bindSplashViews(slot);
    const stalePx = before.px; // snapshot the reference — `before` itself is `slot.views`, mutated in place
    stalePx[0] = 1.5;

    const grown = new ArrayBuffer(mod.HEAPF32.buffer.byteLength + 4096);
    new Uint8Array(grown).set(new Uint8Array(mod.HEAPF32.buffer));
    mod.HEAPF32 = new Float32Array(grown);
    mod.HEAP32 = new Int32Array(grown);
    mod.HEAPU8 = new Uint8Array(grown);

    expect(stalePx.buffer === mod.HEAPF32.buffer).toBe(false); // stale view, old buffer

    const after = bindSplashViews(slot);
    expect(after.px).not.toBe(stalePx);
    expect(after.px.buffer).toBe(mod.HEAPF32.buffer);
    expect(after.px[0]).toBe(1.5); // data survived the copy into the grown buffer
  });
});

describe('WaterfallParticles particle-SoA views', () => {
  it('reuses the same views across frames when the heap has not grown', () => {
    const mod = mockMod();
    const capacity = 32;
    const base = 4;
    const views: WaterfallSoAViews = {};

    const first = bindWaterfallViews(mod, base, capacity, views);
    const second = bindWaterfallViews(mod, base, capacity, views);

    expect(second.px).toBe(first.px);
    expect(second.py).toBe(first.py);
    expect(second.pz).toBe(first.pz);
    expect(second.scale).toBe(first.scale);
  });

  it('rebinds every view after HEAPF32.buffer grows, at the PARTICLE_SOA_PLANES scale offset', () => {
    const mod = mockMod();
    const capacity = 32;
    const base = 4;
    const views: WaterfallSoAViews = {};

    const before = bindWaterfallViews(mod, base, capacity, views);
    const staleScale = before.scale; // snapshot — `before` is `views`, mutated in place
    staleScale[0] = 0.75;

    const grown = new ArrayBuffer(mod.HEAPF32.buffer.byteLength + 8192);
    new Uint8Array(grown).set(new Uint8Array(mod.HEAPF32.buffer));
    mod.HEAPF32 = new Float32Array(grown);
    mod.HEAP32 = new Int32Array(grown);
    mod.HEAPU8 = new Uint8Array(grown);

    expect(staleScale.buffer === mod.HEAPF32.buffer).toBe(false); // stale view, old buffer

    const after = bindWaterfallViews(mod, base, capacity, views);
    expect(after.scale).not.toBe(staleScale);
    expect(after.scale.buffer).toBe(mod.HEAPF32.buffer);
    expect(after.scale[0]).toBe(0.75);
    // scale is plane 8 (last of the 9 SoA planes) — matches PARTICLE_SOA_PLANES.
    expect(after.scale.byteOffset).toBe(base + (PARTICLE_SOA_PLANES - 1) * capacity * 4);
  });
});
