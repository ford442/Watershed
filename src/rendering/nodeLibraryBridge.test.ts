/**
 * Two failure modes, one cause — `three/webgpu` carries its own copy of the core:
 *
 *  - a light class missing from the node library CRASHES the renderer, because
 *    `getLightNodeClass()` answers `null` while `setupLightsNode()` only guards
 *    `undefined`, so `new null( light )` throws on the first lit material;
 *  - a material type missing from it silently swaps the material for a blank
 *    `NodeMaterial`, and only in minified builds, since the table is keyed on a
 *    class name while the lookup uses a `type` string literal.
 */

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

/** Stand-in for three's NodeLibrary — same keying, same lookup return values. */
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
    /** Keys on the class NAME, exactly like three — that is the bug being bridged. */
    addMaterial(materialNodeClass: unknown, materialClass: { name: string }) {
      if (materialNodes.has(materialClass.name)) throw new Error('Redefinition');
      materialNodes.set(materialClass.name, materialNodeClass);
    },
    getLightNodeClass(lightClass: unknown) {
      return lightNodes.get(lightClass as object) || null;
    },
    getMaterialNodeClass(materialType: string) {
      return materialNodes.get(materialType) || null;
    },
  };
}

const rendererWith = (library: ReturnType<typeof createLibrary>) => ({ nodes: { library } });

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
