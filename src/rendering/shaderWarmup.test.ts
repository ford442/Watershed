import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  shadowStateFor,
  warmShaderPrograms,
  warmupShadowModes,
  type ShaderWarmupRecipe,
  type WarmupRenderer,
} from './shaderWarmup';

/** Records the state each compile ran under, the way WebGLPrograms reads it. */
function fakeRenderer() {
  const seen: { target: THREE.WebGLRenderTarget | null; shadowEnabled: boolean; shadowType: THREE.ShadowMapType; materials: THREE.Material[] }[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const programs: unknown[] = [];
  const renderer: WarmupRenderer = {
    shadowMap: { enabled: true, type: THREE.PCFShadowMap },
    getRenderTarget: () => target,
    setRenderTarget: (next) => {
      target = next;
    },
    info: { programs },
    compileAsync: vi.fn(async (root: THREE.Object3D) => {
      const materials: THREE.Material[] = [];
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) materials.push(m as THREE.Material);
      });
      seen.push({ target, shadowEnabled: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type, materials });
      programs.push(...materials);
      return root;
    }),
  };
  return { renderer, seen };
}

const recipe = (id: string): ShaderWarmupRecipe => ({
  id,
  build: () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
});

describe('warmShaderPrograms', () => {
  it('compiles into a target (the post chain\'s tone-map/colour-space variant), then restores the bound one', async () => {
    const { renderer, seen } = fakeRenderer();
    const bound = new THREE.WebGLRenderTarget(4, 4);
    renderer.setRenderTarget?.(bound);
    await warmShaderPrograms(renderer, {
      targetScene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      recipes: [recipe('a')],
      shadowModes: ['soft'],
    });
    expect(seen[0].target).not.toBeNull();
    expect(seen[0].target).not.toBe(bound);
    expect(renderer.getRenderTarget?.()).toBe(bound);
  });

  it('builds fresh instances per shadow variant and restores the shadow state', async () => {
    const { renderer, seen } = fakeRenderer();
    const result = await warmShaderPrograms(renderer, {
      targetScene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      recipes: [recipe('a'), recipe('b')],
      shadowModes: ['soft', 'basic', 'basic'],
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ shadowEnabled: true, shadowType: THREE.PCFShadowMap });
    expect(seen[1]).toMatchObject({ shadowEnabled: true, shadowType: THREE.BasicShadowMap });
    // A material holds one program: the basic variant cannot reuse the soft one's instances.
    expect(seen[1].materials.some((m) => seen[0].materials.includes(m))).toBe(false);
    expect(renderer.shadowMap).toEqual({ enabled: true, type: THREE.PCFShadowMap });
    expect(result).toMatchObject({ objects: 4, programsBefore: 0, programsAfter: 4, failed: [] });
  });

  it('skips a recipe that throws and keeps the rest', async () => {
    const { renderer } = fakeRenderer();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await warmShaderPrograms(renderer, {
      targetScene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      recipes: [{ id: 'broken', build: () => { throw new Error('no'); } }, recipe('ok')],
      shadowModes: ['off'],
    });
    expect(result.failed).toEqual(['broken']);
    expect(result.objects).toBe(1);
    warn.mockRestore();
  });

  it('keeps the warm materials alive until dispose()', async () => {
    const { renderer, seen } = fakeRenderer();
    const result = await warmShaderPrograms(renderer, {
      targetScene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      recipes: [recipe('a')],
      shadowModes: ['soft'],
    });
    const material = seen[0].materials[0];
    const dispose = vi.fn();
    material.addEventListener('dispose', dispose);
    expect(dispose).not.toHaveBeenCalled();
    result.dispose();
    result.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not bind a WebGL target on the node renderer', async () => {
    const { renderer, seen } = fakeRenderer();
    renderer.isWebGPURenderer = true;
    await warmShaderPrograms(renderer, {
      targetScene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      recipes: [recipe('a')],
      shadowModes: ['soft'],
    });
    expect(seen[0].target).toBeNull();
  });
});

describe('warmup shadow modes', () => {
  it('warms the preset and the one step the adaptive valve takes down', () => {
    expect(warmupShadowModes('high')).toEqual(['soft', 'basic']);
    expect(warmupShadowModes('medium')).toEqual(['basic', 'off']);
    expect(warmupShadowModes('low')).toEqual(['off']);
    expect(shadowStateFor('off')).toEqual({ enabled: false, type: null });
    expect(shadowStateFor('basic')).toEqual({ enabled: true, type: THREE.BasicShadowMap });
  });
});
