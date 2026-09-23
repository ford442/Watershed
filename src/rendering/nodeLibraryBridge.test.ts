/**
 * Two failure modes the bridge guards against (see nodeLibraryBridge.ts):
 *
 *  - a light class missing from the node library leaves that light out of every
 *    lit material (r168 went further and threw `new null( light )`), which is
 *    what happens when `three/webgpu` carries its own copy of the core;
 *  - a material type missing from it silently swaps the material for a blank
 *    `NodeMaterial`, and only in minified builds, if the table is ever keyed on
 *    a class name again while the lookup uses a `type` string literal.
 *
 * The first block drives a stand-in library; the last one drives the REAL r178
 * `three.webgpu.js` bundle, where both splits are fixed upstream.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { bridgeCoreNodeClasses } from './nodeLibraryBridge';
import {
  AmbientLightNode,
  DirectionalLightNode,
  HemisphereLightNode,
  LightProbeNode,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PointLightNode,
  PointsNodeMaterial,
  RectAreaLightNode,
  SpotLightNode,
} from 'three/webgpu';

const NODE_EXPORTS = {
  AmbientLightNode,
  DirectionalLightNode,
  HemisphereLightNode,
  PointLightNode,
  RectAreaLightNode,
  SpotLightNode,
  LightProbeNode,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PointsNodeMaterial,
};

/** Stand-in for r178's NodeLibrary — same keying, same lookup return values. */
function createLibrary() {
  const lightNodes = new WeakMap<object, unknown>();
  const materialNodes = new Map<string, unknown>();
  return {
    lightNodes,
    materialNodes,
    addLight(lightNodeClass: unknown, lightClass: unknown) {
      if (lightNodes.has(lightClass as object)) throw new Error('Redefinition');
      lightNodes.set(lightClass as object, lightNodeClass);
    },
    /** r178 takes the type string itself and refuses anything else. */
    addMaterial(materialNodeClass: unknown, materialType: unknown) {
      if (typeof materialType !== 'string') throw new Error('Base class is not a class');
      if (materialNodes.has(materialType)) throw new Error('Redefinition');
      materialNodes.set(materialType, materialNodeClass);
    },
    getLightNodeClass(lightClass: unknown) {
      return lightNodes.get(lightClass as object) || null;
    },
    getMaterialNodeClass(materialType: string) {
      return materialNodes.get(materialType) || null;
    },
  };
}

const rendererWith = (library: ReturnType<typeof createLibrary>) => ({ library });

describe('bridgeCoreNodeClasses', () => {
  it('registers every core light class the scene can mount', () => {
    const library = createLibrary();
    expect(bridgeCoreNodeClasses(rendererWith(library), NODE_EXPORTS).lights).toBe(7);

    for (const light of [
      new THREE.AmbientLight(),
      new THREE.DirectionalLight(),
      new THREE.HemisphereLight(),
      new THREE.PointLight(),
      new THREE.RectAreaLight(),
      new THREE.SpotLight(),
      new THREE.LightProbe(),
    ]) {
      const nodeClass = library.getLightNodeClass(light.constructor);
      expect(typeof nodeClass).toBe('function');
      // The crash was `new null(light)`; prove the bridged entry constructs.
      expect(() => new (nodeClass as new (l: unknown) => unknown)(light)).not.toThrow();
    }
  });

  it('registers material node classes under the type string, not the class name', () => {
    const library = createLibrary();
    bridgeCoreNodeClasses(rendererWith(library), NODE_EXPORTS);

    // `material.type` is the literal a minifier cannot touch — that is the key
    // three looks up, so that is the key the bridge must write.
    expect(library.getMaterialNodeClass(new THREE.MeshBasicMaterial().type)).toBe(
      MeshBasicNodeMaterial,
    );
    expect(library.getMaterialNodeClass(new THREE.MeshStandardMaterial().type)).toBe(
      MeshStandardNodeMaterial,
    );
    expect(library.getMaterialNodeClass(new THREE.PointsMaterial().type)).toBe(PointsNodeMaterial);
  });

  it('is idempotent — a second Canvas must not trip "Redefinition"', () => {
    const library = createLibrary();
    bridgeCoreNodeClasses(rendererWith(library), NODE_EXPORTS);
    expect(bridgeCoreNodeClasses(rendererWith(library), NODE_EXPORTS)).toEqual({
      lights: 0,
      materials: 0,
    });
  });

  it('is inert on a renderer with no node library', () => {
    expect(bridgeCoreNodeClasses({}, NODE_EXPORTS)).toEqual({ lights: 0, materials: 0 });
    expect(bridgeCoreNodeClasses(null, NODE_EXPORTS)).toEqual({ lights: 0, materials: 0 });
  });

  it('skips classes the loaded three/webgpu build does not export', () => {
    const library = createLibrary();
    const result = bridgeCoreNodeClasses(rendererWith(library), { DirectionalLightNode });
    expect(result).toEqual({ lights: 1, materials: 0 });
    expect(library.getLightNodeClass(THREE.PointLight)).toBeNull();
    expect(library.getMaterialNodeClass('MeshBasicMaterial')).toBeNull();
  });
});

/**
 * The real bundle, not the `three/webgpu` test double vitest.config.ts aliases.
 * It is loaded by path because `three`'s exports map does not expose `build/`.
 */
const REAL_WEBGPU_BUNDLE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/three/build/three.webgpu.js',
);

describe('bridgeCoreNodeClasses against the real three r178 bundle', () => {
  async function loadRealRenderer(): Promise<{ real: any; renderer: any }> {
    const real = await import(/* @vite-ignore */ REAL_WEBGPU_BUNDLE);
    // Constructing is enough: the library exists before `init()` touches a context.
    const renderer = new real.WebGPURenderer({
      canvas: document.createElement('canvas'),
      forceWebGL: true,
    });
    return { real, renderer };
  }

  it('shares one core with `three`, so light classes are identical', async () => {
    const { real } = await loadRealRenderer();
    expect(real.REVISION).toBe(THREE.REVISION);
    expect(real.DirectionalLight).toBe(THREE.DirectionalLight);
    expect(real.MeshBasicMaterial).toBe(THREE.MeshBasicMaterial);
  });

  it('has nothing to bridge on a healthy r178 renderer', async () => {
    const { real, renderer } = await loadRealRenderer();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(bridgeCoreNodeClasses(renderer, real)).toEqual({ lights: 0, materials: 0 });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    expect(renderer.library.getLightNodeClass(THREE.DirectionalLight)).toBe(
      real.DirectionalLightNode,
    );
    expect(renderer.library.getMaterialNodeClass(new THREE.MeshBasicMaterial().type)).toBe(
      real.MeshBasicNodeMaterial,
    );
  });

  it('re-registers an entry the library has lost', async () => {
    const { real, renderer } = await loadRealRenderer();
    renderer.library.materialNodes.delete('MeshStandardMaterial');
    renderer.library.lightNodes.delete(THREE.SpotLight);

    expect(bridgeCoreNodeClasses(renderer, real)).toEqual({ lights: 1, materials: 1 });
    expect(renderer.library.getMaterialNodeClass('MeshStandardMaterial')).toBe(
      real.MeshStandardNodeMaterial,
    );
    expect(renderer.library.getLightNodeClass(THREE.SpotLight)).toBe(real.SpotLightNode);
  });
});
