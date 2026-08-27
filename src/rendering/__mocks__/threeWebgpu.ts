/**
 * Test stub for the ESM-only `three/webgpu` and `three/tsl` subpath exports.
 *
 * Vitest aliases these subpaths to this file (see vitest.config.ts) so unit
 * tests can import `RiverNodeMaterial.ts` without loading the real WebGPU
 * bundle. Vite continues to use the real `three/webgpu` bundle in the browser.
 */

import * as THREE from 'three';

/**
 * The node getters intentionally return undefined so the stub behaves like a
 * plain material, but tests still need to see that a graph was assigned — so
 * each assignment is mirrored into `userData.__nodeSlots`.
 */
function recordNodeSlot(material: THREE.Material, slot: string, value: unknown): void {
  const slots = (material.userData.__nodeSlots ?? {}) as Record<string, unknown>;
  slots[slot] = value;
  material.userData.__nodeSlots = slots;
}

export class MeshBasicNodeMaterial extends THREE.MeshBasicMaterial {
  lights = true;
  private _nodeProps: Record<string, unknown> = {};

  constructor(parameters: THREE.MeshBasicMaterialParameters = {}) {
    super(parameters);
    (this as any).type = 'MeshBasicNodeMaterial';
  }

  set colorNode(value: unknown) {
    this._nodeProps.colorNode = value;
    recordNodeSlot(this, 'colorNode', value);
  }
  get colorNode() {
    return undefined;
  }

  set positionNode(value: unknown) {
    this._nodeProps.positionNode = value;
    recordNodeSlot(this, 'positionNode', value);
  }
  get positionNode() {
    return undefined;
  }

  set opacityNode(value: unknown) {
    this._nodeProps.opacityNode = value;
    recordNodeSlot(this, 'opacityNode', value);
  }
  get opacityNode() {
    return undefined;
  }
}

export class PointsNodeMaterial extends MeshBasicNodeMaterial {
  constructor(parameters: THREE.PointsMaterialParameters = {}) {
    super(parameters as THREE.MeshBasicMaterialParameters);
    (this as { type: string }).type = 'PointsNodeMaterial';
  }

  set sizeNode(value: unknown) {
    recordNodeSlot(this, 'sizeNode', value);
  }
  get sizeNode() {
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
    recordNodeSlot(this, 'colorNode', value);
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

  set positionNode(value: unknown) {
    this._nodeProps.positionNode = value;
    recordNodeSlot(this, 'positionNode', value);
  }
  get positionNode() {
    return undefined;
  }
}

/**
 * Minimal WebGPURenderer double. Unit tests never touch a GPU, so this behaves
 * like a WebGLRenderer that reports `isWebGPURenderer` and a WebGL backend —
 * which is exactly what `forceWebGL: true` produces in the browser.
 */
export class WebGPURenderer extends THREE.WebGLRenderer {
  isWebGPURenderer = true;
  backend: { isWebGPUBackend: boolean };

  constructor(parameters: THREE.WebGLRendererParameters & { forceWebGL?: boolean } = {}) {
    const { forceWebGL, ...rest } = parameters;
    super(rest);
    this.backend = { isWebGPUBackend: !forceWebGL };
  }

  async init(): Promise<void> {
    // no-op: the real renderer negotiates an adapter here
  }
}

/**
 * Node test double. Any property access returns another node, so the fluent TSL
 * chains in the real materials build without a WebGPU runtime.
 *
 * `.value` is real state, not a constant: uniform nodes are how the render loop
 * talks to a material every frame, so tests need writes to stick and read back.
 */
function createNode(label = 'node', seed?: unknown): any {
  const state = { value: seed ?? 0 };
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'toString') return () => `[Node ${label}]`;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'value') return state.value;
      if (prop === 'type') return 'Node';
      if (prop === 'isNode') return true;
      return createNode(`${label}.${String(prop)}`);
    },
    set(_, prop, next) {
      if (prop === 'value') {
        state.value = next;
      }
      return true;
    },
    apply(_, __, args) {
      // `uniform(x)` / `texture(x)` seed their node with the initial value, which
      // is what a material's constructor-time defaults rely on.
      return createNode(`${label}(...)`, args[0]);
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
export const cos = createNode('cos');
export const cross = createNode('cross');
export const length = createNode('length');
export const reflect = createNode('reflect');
export const positionLocal = createNode('positionLocal');
export const vec4 = createNode('vec4');
export const materialColor = createNode('materialColor');
export const materialRoughness = createNode('materialRoughness');
export const mod = createNode('mod');
export const instanceMatrix = createNode('instanceMatrix');
export const pointUV = createNode('pointUV');
