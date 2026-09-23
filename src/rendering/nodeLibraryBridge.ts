/**
 * nodeLibraryBridge — teaches the node renderer about `three`'s own classes.
 *
 * The node renderer resolves a light's node class from `NodeLibrary.lightNodes`
 * (a WeakMap keyed on the LIGHT CLASS ITSELF) and a plain material's node class
 * from `NodeLibrary.materialNodes` (a Map keyed on a type string). Both lookups
 * have broken on this project before:
 *
 * LIGHTS — through r170, `three/webgpu` was a SEPARATE bundle carrying its own
 * copy of the three core, so `(await import('three/webgpu')).DirectionalLight
 * !== THREE.DirectionalLight`. Every light in the scene is built from `three`
 * (R3F's catalogue), the lookup missed, and r168 threw `TypeError:
 * lightNodeClass is not a constructor` on the first lit material. `?material=tsl`
 * rendered an empty canvas because of it.
 *
 * MATERIALS — r168 keyed `materialNodes` by `materialClass.name`, a class name,
 * while lookups use `material.type`, a string literal. Those agree only until a
 * minifier renames the class, so production builds logged `NodeMaterial:
 * Material "…" is not compatible.` and swapped in a blank `NodeMaterial`.
 *
 * AT r178 BOTH ARE FIXED UPSTREAM. `three.module.js` and `three.webgpu.js`
 * import one shared `three.core.js`, so the light classes are identical, and
 * `StandardNodeLibrary` registers materials by their type strings. The bridge
 * therefore bridges nothing on a healthy r178 renderer — `nodeLibraryBridge
 * .test.ts` pins that against the real bundle. It stays as the guard: if a
 * later bump reintroduces either split, it re-registers the missing entries
 * instead of the canvas going blank. Extend the pair tables below for any new
 * class-identity lookup.
 */

import * as THREE from 'three';

/** The slice of r178's `NodeLibrary` we depend on. */
interface NodeLibraryLike {
  addLight(lightNodeClass: unknown, lightClass: unknown): void;
  addMaterial(materialNodeClass: unknown, materialType: string): void;
  lightNodes?: WeakMap<object, unknown>;
  materialNodes?: Map<string, unknown>;
}

/** r178 hangs the library off the renderer itself (r168: `renderer.nodes`). */
interface NodeRendererLike {
  library?: NodeLibraryLike;
}

/** Node classes exported by `three/webgpu`, paired below to their core class. */
export interface NodeClassExports {
  AmbientLightNode?: unknown;
  DirectionalLightNode?: unknown;
  HemisphereLightNode?: unknown;
  PointLightNode?: unknown;
  RectAreaLightNode?: unknown;
  SpotLightNode?: unknown;
  LightProbeNode?: unknown;
  LineBasicNodeMaterial?: unknown;
  LineDashedNodeMaterial?: unknown;
  MeshBasicNodeMaterial?: unknown;
  MeshLambertNodeMaterial?: unknown;
  MeshMatcapNodeMaterial?: unknown;
  MeshNormalNodeMaterial?: unknown;
  MeshPhongNodeMaterial?: unknown;
  MeshPhysicalNodeMaterial?: unknown;
  MeshStandardNodeMaterial?: unknown;
  MeshToonNodeMaterial?: unknown;
  PointsNodeMaterial?: unknown;
  ShadowNodeMaterial?: unknown;
  SpriteNodeMaterial?: unknown;
}

function lightPairs(nodes: NodeClassExports): Array<[unknown, unknown]> {
  return [
    [nodes.AmbientLightNode, THREE.AmbientLight],
    [nodes.DirectionalLightNode, THREE.DirectionalLight],
    [nodes.HemisphereLightNode, THREE.HemisphereLight],
    [nodes.PointLightNode, THREE.PointLight],
    [nodes.RectAreaLightNode, THREE.RectAreaLight],
    [nodes.SpotLightNode, THREE.SpotLight],
    [nodes.LightProbeNode, THREE.LightProbe],
  ];
}

/**
 * Node material class paired with the `material.type` string it must answer to.
 * The type strings are literals in each material's constructor, so unlike the
 * class names they mean the same thing on both sides of a minifier.
 */
function materialPairs(nodes: NodeClassExports): Array<[unknown, string]> {
  return [
    [nodes.LineBasicNodeMaterial, 'LineBasicMaterial'],
    [nodes.LineDashedNodeMaterial, 'LineDashedMaterial'],
    [nodes.MeshBasicNodeMaterial, 'MeshBasicMaterial'],
    [nodes.MeshLambertNodeMaterial, 'MeshLambertMaterial'],
    [nodes.MeshMatcapNodeMaterial, 'MeshMatcapMaterial'],
    [nodes.MeshNormalNodeMaterial, 'MeshNormalMaterial'],
    [nodes.MeshPhongNodeMaterial, 'MeshPhongMaterial'],
    [nodes.MeshPhysicalNodeMaterial, 'MeshPhysicalMaterial'],
    [nodes.MeshStandardNodeMaterial, 'MeshStandardMaterial'],
    [nodes.MeshToonNodeMaterial, 'MeshToonMaterial'],
    [nodes.PointsNodeMaterial, 'PointsMaterial'],
    [nodes.ShadowNodeMaterial, 'ShadowMaterial'],
    [nodes.SpriteNodeMaterial, 'SpriteMaterial'],
  ];
}

export interface BridgeResult {
  lights: number;
  materials: number;
}

/**
 * Register `three`'s light classes and the core `material.type` strings with the
 * renderer's node library.
 *
 * @returns how many of each were bridged. All zeros is the healthy r178 answer
 *   (every entry was already registered); anything else means a split the
 *   header describes has come back.
 */
export function bridgeCoreNodeClasses(
  renderer: unknown,
  nodeExports: NodeClassExports,
): BridgeResult {
  const library = (renderer as NodeRendererLike | null)?.library;
  const result: BridgeResult = { lights: 0, materials: 0 };
  if (!library) return result;

  if (typeof library.addLight === 'function') {
    for (const [lightNodeClass, lightClass] of lightPairs(nodeExports)) {
      if (typeof lightNodeClass !== 'function' || typeof lightClass !== 'function') continue;
      // Already known (r178's own registration, or a second Canvas on the same
      // library) — adding again would only earn a "Redefinition of node" warning.
      if (library.lightNodes?.has(lightClass)) continue;
      try {
        library.addLight(lightNodeClass, lightClass);
        result.lights += 1;
      } catch (error) {
        console.warn('[Renderer] Could not bridge light class to the node library', error);
      }
    }
  }

  if (typeof library.addMaterial === 'function') {
    for (const [materialNodeClass, materialType] of materialPairs(nodeExports)) {
      if (typeof materialNodeClass !== 'function') continue;
      if (library.materialNodes?.has(materialType)) continue;
      try {
        // Going through the public method keeps its redefinition and
        // not-a-class guards.
        library.addMaterial(materialNodeClass, materialType);
        result.materials += 1;
      } catch (error) {
        console.warn('[Renderer] Could not bridge material type to the node library', error);
      }
    }
  }

  return result;
}
