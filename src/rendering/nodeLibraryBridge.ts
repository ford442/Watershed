/**
 * nodeLibraryBridge — teaches the node renderer about `three`'s own classes.
 *
 * `three/webgpu` is a SEPARATE bundle that ships its own copy of the three core,
 * so `(await import('three/webgpu')).DirectionalLight !== THREE.DirectionalLight`
 * even though both are r168. `resolve.dedupe` cannot merge them: they are two
 * entry files, not two installs. `NodeLibrary` indexes both of its tables by
 * something that does not survive that split, so both need bridging.
 *
 * LIGHTS — `NodeLibrary.lightNodes` is a WeakMap keyed on the LIGHT CLASS ITSELF.
 * Every light in the scene is built from `three` (R3F's catalogue), so the lookup
 * missed; `getLightNodeClass()` returns `null` while `LightsNode.setupLightsNode()`
 * only guards against `undefined`, so the miss reached `new null( light )` and
 * threw `TypeError: lightNodeClass is not a constructor` on the first lit
 * material. `?material=tsl` rendered an empty canvas because of it.
 *
 * MATERIALS — `NodeLibrary.materialNodes` is keyed by `materialClass.name`, the
 * class name, while lookups use `material.type`, a string literal. Those agree
 * only until a minifier renames the class: in a production build the table is
 * keyed `"Yw"` and the lookup asks for `"MeshBasicMaterial"`. Every plain
 * material handed to the node renderer then logs `NodeMaterial: Material "…" is
 * not compatible.` and is replaced by a blank `new NodeMaterial()`. Dev builds
 * are unaffected, which is exactly what makes it worth pinning down here.
 */

import * as THREE from 'three';

/** The slice of `NodeLibrary` we depend on. */
interface NodeLibraryLike {
  addLight(lightNodeClass: unknown, lightClass: unknown): void;
  addMaterial(materialNodeClass: unknown, materialClass: unknown): void;
  lightNodes?: WeakMap<object, unknown>;
  materialNodes?: Map<string, unknown>;
}

interface NodeRendererLike {
  nodes?: { library?: NodeLibraryLike };
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
 * @returns how many of each were bridged. All zeros means the renderer exposed
 *   no node library, which is only expected from a test double.
 */
export function bridgeCoreNodeClasses(
  renderer: unknown,
  nodeExports: NodeClassExports,
): BridgeResult {
  const library = (renderer as NodeRendererLike | null)?.nodes?.library;
  const result: BridgeResult = { lights: 0, materials: 0 };
  if (!library) return result;

  if (typeof library.addLight === 'function') {
    for (const [lightNodeClass, lightClass] of lightPairs(nodeExports)) {
      if (typeof lightNodeClass !== 'function' || typeof lightClass !== 'function') continue;
      // Already bridged (a second Canvas on the same library) — adding again
      // would only earn a "Redefinition of node" warning.
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
        // `addMaterial` keys on `materialClass.name`, so a `{ name }` stand-in is
        // how we register the type string it should have used. Going through the
        // public method keeps its redefinition and not-a-class guards.
        library.addMaterial(materialNodeClass, { name: materialType });
        result.materials += 1;
      } catch (error) {
        console.warn('[Renderer] Could not bridge material type to the node library', error);
      }
    }
  }

  return result;
}
