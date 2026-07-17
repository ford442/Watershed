/**
 * Test stub for the ESM-only `three/webgpu` and `three/tsl` subpath exports.
 *
 * Vitest aliases these subpaths to this file (see vitest.config.ts) so unit
 * tests can import `RiverNodeMaterial.ts` without loading the real WebGPU
 * bundle. Vite continues to use the real `three/webgpu` bundle in the browser.
 */

import * as THREE from 'three';

export class MeshBasicNodeMaterial extends THREE.MeshBasicMaterial {
  lights = true;
  private _nodeProps: Record<string, unknown> = {};

  constructor(parameters: THREE.MeshBasicMaterialParameters = {}) {
    super(parameters);
    (this as any).type = 'MeshBasicNodeMaterial';
  }

  set colorNode(value: unknown) {
    this._nodeProps.colorNode = value;
  }
  get colorNode() {
    return undefined;
  }
}

export class MeshStandardNodeMaterial extends THREE.MeshStandardMaterial {
  private _nodeProps: Record<string, unknown> = {};

  constructor(parameters: THREE.MeshStandardMaterialParameters = {}) {
    // Filter undefined entries to avoid THREE.Material warnings in the stub.
    const defined: THREE.MeshStandardMaterialParameters = {};
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined) {
        (defined as any)[key] = value;
      }
    }
    super(defined);
    (this as any).type = 'MeshStandardNodeMaterial';
  }

  // Absorb TSL node graph assignments from createRiverNodeMaterial() so the
  // Jest WebGLRenderer stub compiles this as a plain MeshStandardMaterial.
  set colorNode(value: unknown) {
    this._nodeProps.colorNode = value;
  }
  get colorNode() {
    return undefined;
  }

  set roughnessNode(value: unknown) {
    this._nodeProps.roughnessNode = value;
  }
  get roughnessNode() {
    return undefined;
  }
}

function createNode(label = 'node'): any {
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'toString') return () => `[Node ${label}]`;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'value') return 0;
      if (prop === 'type') return 'Node';
      if (prop === 'isNode') return true;
      return createNode(`${label}.${String(prop)}`);
    },
    apply(_, __, args) {
      return createNode(`${label}(...)`);
    },
  });
}

// TSL-like node factory exports used by RiverNodeMaterial.ts and its helpers.
export function Fn(builder: any) {
  return (...args: any[]) => (typeof builder === 'function' ? builder(args) : builder);
}
export const float = createNode('float');
export const vec2 = createNode('vec2');
export const vec3 = createNode('vec3');
export const uniform = createNode('uniform');
export const attribute = createNode('attribute');
export const texture = createNode('texture');
export const uv = createNode('uv');
export const positionWorld = createNode('positionWorld');
export const normalWorld = createNode('normalWorld');
export const cameraPosition = createNode('cameraPosition');
export const smoothstep = createNode('smoothstep');
export const mix = createNode('mix');
export const dot = createNode('dot');
export const normalize = createNode('normalize');
export const sin = createNode('sin');
export const clamp = createNode('clamp');
export const max = createNode('max');
export const min = createNode('min');
export const pow = createNode('pow');
export const abs = createNode('abs');
export const step = createNode('step');
export const fract = createNode('fract');
export const floor = createNode('floor');
export const mul = createNode('mul');
export const materialColor = createNode('materialColor');
export const materialRoughness = createNode('materialRoughness');
