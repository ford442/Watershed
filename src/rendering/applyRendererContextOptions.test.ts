import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyRendererContextOptions,
  applyRendererQualityUpdate,
  getRendererShadowMapSize,
  type RendererContextTarget,
} from './applyRendererContextOptions';
import { deriveRendererContextOptions } from './deriveRendererContextOptions';

type FakeRenderer = RendererContextTarget & {
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType; needsUpdate?: boolean };
};

function fakeRenderer(): FakeRenderer {
  return {
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap, needsUpdate: false },
  };
}

/** A shadowless context — no preset derives one since #574 E.2, but the mechanism still handles it. */
function shadowless() {
  return { ...deriveRendererContextOptions('high'), shadowMode: 'off' as const, shadowMapSize: null };
}

/** Minimal stand-in for the scene walk — one mesh, one material. */
function sceneWithMaterials(count: number) {
  const materials = Array.from({ length: count }, () => ({ needsUpdate: false }));
  return {
    materials,
    traverse(callback: (object: unknown) => void) {
      for (const material of materials) callback({ material });
    },
  };
}

describe('applyRendererContextOptions', () => {
  it('applies color space, tone mapping, and soft shadows for high', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, deriveRendererContextOptions('high'));

    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(getRendererShadowMapSize(renderer)).toBe(2048);
  });

  it('keeps PCF shadows on for low, at the smallest map (#574 E.2)', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, deriveRendererContextOptions('low'));

    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(getRendererShadowMapSize(renderer)).toBe(512);
  });

  it('disables shadows for a shadowless context', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, shadowless());

    expect(renderer.shadowMap.enabled).toBe(false);
    expect(getRendererShadowMapSize(renderer)).toBeNull();
  });
});

describe('applyRendererQualityUpdate — live quality without a Canvas remount', () => {
  it('marks no material for any preset change — one shadow type on every tier (#574 E.2)', () => {
    const presets = ['low', 'medium', 'high', 'ultra'] as const;
    for (const from of presets) {
      for (const to of presets) {
        const renderer = fakeRenderer();
        applyRendererContextOptions(renderer, deriveRendererContextOptions(from, { devicePixelRatio: 2 }));
        const scene = sceneWithMaterials(2);
        const result = applyRendererQualityUpdate(
          renderer,
          deriveRendererContextOptions(to, { devicePixelRatio: 2 }),
          scene
        );
        expect(result.shadowConfigChanged).toBe(false);
        expect(scene.materials.some((m) => m.needsUpdate)).toBe(false);
      }
    }
  });

  it('recompiles when shadows are switched on (shadowless → high)', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, shadowless());
    const scene = sceneWithMaterials(3);

    const result = applyRendererQualityUpdate(
      renderer,
      deriveRendererContextOptions('high'),
      scene
    );

    // three bakes USE_SHADOWMAP / SHADOWMAP_TYPE_* into each program and does
    // not list them in needsProgramChange, so without this the old program
    // keeps rendering without shadows.
    expect(result.shadowConfigChanged).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    expect(scene.materials.every((m) => m.needsUpdate)).toBe(true);
  });

  it('recompiles when shadows are switched off entirely (high → shadowless)', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, deriveRendererContextOptions('high'));
    const scene = sceneWithMaterials(2);

    const result = applyRendererQualityUpdate(renderer, shadowless(), scene);

    expect(result.shadowConfigChanged).toBe(true);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(scene.materials.every((m) => m.needsUpdate)).toBe(true);
  });

  it('leaves materials alone when only DPR changes (high → ultra on 1x)', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, deriveRendererContextOptions('high'));
    const scene = sceneWithMaterials(2);

    const result = applyRendererQualityUpdate(
      renderer,
      deriveRendererContextOptions('ultra', { devicePixelRatio: 2 }),
      scene
    );

    expect(result.shadowConfigChanged).toBe(false);
    expect(result.toneMappingChanged).toBe(false);
    expect(scene.materials.some((m) => m.needsUpdate)).toBe(false);
  });

  it('updates the stored shadow map size so lights follow the new preset', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, deriveRendererContextOptions('medium'));
    expect(getRendererShadowMapSize(renderer)).toBe(1024);

    applyRendererQualityUpdate(
      renderer,
      deriveRendererContextOptions('ultra', { devicePixelRatio: 2 })
    );
    expect(getRendererShadowMapSize(renderer)).toBe(4096);
  });

  it('never touches creation-time attributes', () => {
    const renderer = fakeRenderer() as FakeRenderer & Record<string, unknown>;
    applyRendererQualityUpdate(renderer, deriveRendererContextOptions('high'));

    expect(renderer.antialias).toBeUndefined();
    expect(renderer.alpha).toBeUndefined();
    expect(renderer.failIfMajorPerformanceCaveat).toBeUndefined();
  });

  it('tolerates a scene with array materials and material-less objects', () => {
    const renderer = fakeRenderer();
    applyRendererContextOptions(renderer, shadowless());
    const multi = [{ needsUpdate: false }, { needsUpdate: false }];
    const scene = {
      traverse(callback: (object: unknown) => void) {
        callback({});
        callback({ material: null });
        callback({ material: multi });
      },
    };

    expect(() =>
      applyRendererQualityUpdate(renderer, deriveRendererContextOptions('high'), scene)
    ).not.toThrow();
    expect(multi.every((m) => m.needsUpdate)).toBe(true);
  });
});
