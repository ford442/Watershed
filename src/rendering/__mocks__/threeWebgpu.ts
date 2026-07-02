/**
 * Jest stub for the ESM-only `three/webgpu` and `three/tsl` subpath exports.
 *
 * `react-scripts` / Jest cannot resolve `three/webgpu` and `three/tsl` because
 * three.js only exposes them as ESM exports. This stub provides the minimal
 * shapes the regression guard needs so that `RiverNodeMaterial.ts` can be
 * imported and its factory called in unit tests.
 *
 * This file is ONLY used by Jest via `moduleNameMapper` in `package.json`.
 * Vite continues to use the real `three/webgpu` bundle in the browser.
 */

import * as THREE from 'three';

export class MeshStandardNodeMaterial extends THREE.MeshStandardMaterial {
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
export function Fn(builder: (args: any[]) => any) {
  return (...args: any[]) => builder(args);
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
