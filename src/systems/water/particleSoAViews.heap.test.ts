import {
  bindSplashViews,
  bindWaterfallViews,
  type SplashWasmSlot,
  type WaterfallSoAViews,
} from '../pools/nativeParticles';
import { PARTICLE_SOA_PLANES, type WatershedNativeModule } from './wasmAbi';

/**
 * The splash/mist and waterfall particle-SoA views (#415/#419): made once per
 * allocation over the fixed-size heap (ALLOW_MEMORY_GROWTH=0) and reused every
 * frame, each at its plane's offset.
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
  it('reuses the same views across frames', () => {
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

  it('lays the eight planes out cap floats apart from ptr', () => {
    const mod = mockMod();
    const cap = 16;
    const slot: SplashWasmSlot = { mod, ptr: 4, cap, views: {} };
    const views = bindSplashViews(slot);
    const order = [views.px, views.py, views.pz, views.vx, views.vy, views.vz, views.life, views.maxLife];
    order.forEach((view, plane) => {
      expect(view.buffer).toBe(mod.HEAPF32.buffer);
      expect(view.byteOffset).toBe(4 + plane * cap * 4);
      expect(view.length).toBe(cap);
    });
  });
});

describe('WaterfallParticles particle-SoA views', () => {
  it('reuses the same views across frames', () => {
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

  it('puts scale on the last of the PARTICLE_SOA_PLANES planes', () => {
    const mod = mockMod();
    const capacity = 32;
    const base = 4;
    const views = bindWaterfallViews(mod, base, capacity, {});
    expect(views.scale.buffer).toBe(mod.HEAPF32.buffer);
    expect(views.scale.byteOffset).toBe(base + (PARTICLE_SOA_PLANES - 1) * capacity * 4);
  });
});
