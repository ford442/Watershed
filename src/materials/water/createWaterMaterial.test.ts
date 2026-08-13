/**
 * Host-factory guards for the water material (#256 path A, phase 0/1).
 *
 * The point of the host is that FlowingWater's per-frame loop doesn't care which
 * backend it got. These tests lock that: identical uniform key sets, both
 * materials constructible in the same process, and a TSL failure degrading to
 * GLSL rather than throwing into the Canvas.
 */

import * as THREE from 'three';

const nodeBuild = { shouldThrow: false };

// The host reads node materials through the lazy cache (nodeMaterials.ts), so
// every TSL test preloads it first — mirroring what createGameRenderer does.
vi.mock('./WaterNodeMaterial', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./WaterNodeMaterial')>();
  return {
    ...actual,
    createWaterNodeMaterial: (init: Parameters<typeof actual.createWaterNodeMaterial>[0]) => {
      if (nodeBuild.shouldThrow) throw new Error('TSL surface drifted');
      return actual.createWaterNodeMaterial(init);
    },
  };
});

import { createWaterMaterial, resetWaterMaterialWarnings } from './createWaterMaterial';
import { createWaterNodeMaterial, isWaterNodeMaterial } from './WaterNodeMaterial';
import {
  WATER_UNIFORM_NAMES,
  createGlslWaterUniforms,
  type WaterUniformInit,
} from './waterUniformSpec';
import { loadNodeMaterials, resetNodeMaterialsCache } from '../nodeMaterials';

const INIT: WaterUniformInit = {
  flowSpeed: 1.4,
  waterColor: '#2a6f8a',
  deepColor: '#123a4a',
  foamColor: '#ffffff',
  edgeHighlight: '#9fe8ff',
};

const GLSL = {
  vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
  fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
  defines: { FOAM_INTENSITY: '1.000' },
};

beforeAll(async () => {
  await loadNodeMaterials();
});

beforeEach(() => {
  resetWaterMaterialWarnings();
  nodeBuild.shouldThrow = false;
});

describe('createWaterMaterial', () => {
  it('builds a GLSL ShaderMaterial by default', () => {
    const handle = createWaterMaterial({ backend: 'glsl', init: INIT, glsl: GLSL });
    expect(handle.backend).toBe('glsl');
    expect((handle.material as THREE.ShaderMaterial).isShaderMaterial).toBe(true);
    expect(handle.material.userData.materialBackend).toBe('glsl');
  });

  it('builds a TSL node material when asked', () => {
    const handle = createWaterMaterial({ backend: 'tsl', init: INIT, glsl: GLSL });
    expect(handle.backend).toBe('tsl');
    expect(isWaterNodeMaterial(handle.material)).toBe(true);
  });

  it('exposes the identical uniform key set on both backends', () => {
    const glsl = createWaterMaterial({ backend: 'glsl', init: INIT, glsl: GLSL });
    const tsl = createWaterMaterial({ backend: 'tsl', init: INIT, glsl: GLSL });

    const expected = [...WATER_UNIFORM_NAMES].sort();
    expect(Object.keys(glsl.uniforms).sort()).toEqual(expected);
    expect(Object.keys(tsl.uniforms).sort()).toEqual(expected);
  });

  it('accepts a `.value` write on every uniform — that is the render-loop contract', () => {
    // FlowingWater pokes `material.uniforms.<name>.value` each frame. TSL uniform
    // and texture nodes are `.value`-addressable, so the same loop drives both
    // backends; this asserts no uniform is missing or read-only.
    const tsl = createWaterMaterial({ backend: 'tsl', init: INIT, glsl: GLSL });
    for (const name of WATER_UNIFORM_NAMES) {
      const handle = tsl.uniforms[name];
      expect(handle, `uniform ${name}`).toBeTruthy();
      expect(() => {
        (handle as { value: unknown }).value = 1;
      }, `uniform ${name} is writable`).not.toThrow();
    }
  });

  it('falls back to GLSL when the node module has not been loaded yet', async () => {
    resetNodeMaterialsCache();
    const handle = createWaterMaterial({ backend: 'tsl', init: INIT, glsl: GLSL });

    expect(handle.backend).toBe('glsl');
    expect(handle.fallbackReason).toBe('node material module not loaded');

    await loadNodeMaterials();
  });

  it('falls back to GLSL — never throws — when the node material cannot be built', () => {
    nodeBuild.shouldThrow = true;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const handle = createWaterMaterial({ backend: 'tsl', init: INIT, glsl: GLSL });

    expect(handle.backend).toBe('glsl');
    expect((handle.material as THREE.ShaderMaterial).isShaderMaterial).toBe(true);
    expect(handle.fallbackReason).toContain('TSL surface drifted');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('water uniform spec', () => {
  it('seeds colors as THREE.Color instances the shader can consume', () => {
    const uniforms = createGlslWaterUniforms(INIT);
    expect(uniforms.waterColor.value).toBeInstanceOf(THREE.Color);
    expect(uniforms.deepColor.value).toBeInstanceOf(THREE.Color);
    expect(uniforms.foamColor.value).toBeInstanceOf(THREE.Color);
  });

  it('never hands a caller-owned Color to the material', () => {
    const shared = new THREE.Color('#ff0000');
    const uniforms = createGlslWaterUniforms({ ...INIT, waterColor: shared });
    expect(uniforms.waterColor.value).not.toBe(shared);
    expect((uniforms.waterColor.value as THREE.Color).getHex()).toBe(shared.getHex());
  });

  it('parks vehicle and vortex sentinels far away so their terms stay inert', () => {
    const uniforms = createGlslWaterUniforms(INIT);
    expect((uniforms.vehiclePos.value as THREE.Vector3).x).toBeGreaterThan(9999);
    expect((uniforms.vortexCenter.value as THREE.Vector3).x).toBeGreaterThan(9999);
    expect(uniforms.vortexIntensity.value).toBe(0);
  });

  it('starts SWE displacement disabled until WaterForceSystem enables it', () => {
    const uniforms = createGlslWaterUniforms(INIT);
    expect(uniforms.sweEnabled.value).toBe(0);
    expect(uniforms.sweHeightMap.value).toBeNull();
  });
});

describe('createWaterNodeMaterial', () => {
  it('is transparent, double-sided, and depth-write off like the GLSL surface', () => {
    const material = createWaterNodeMaterial(INIT);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);
  });

  it('assigns both node graph slots', () => {
    const material = createWaterNodeMaterial(INIT);
    const slots = material.userData.__nodeSlots as Record<string, unknown>;
    expect(slots.positionNode).toBeDefined();
    expect(slots.colorNode).toBeDefined();
    expect(material.userData.materialBackend).toBe('tsl');
  });
});
