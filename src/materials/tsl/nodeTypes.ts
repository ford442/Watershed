/**
 * nodeTypes — shared TSL node type aliases (#466 Phase D).
 *
 * `pnpm typecheck` now checks against the real `three/webgpu` / `three/tsl`
 * types instead of the vitest mock. Those types are dimension-typed: an
 * untyped `Node` has no `.mul` / `.xz` / `.rgb`, so Fn parameters, uniforms
 * and attributes say what they carry. Type-only: nothing here exists at runtime.
 */
import type { Node, UniformNode } from 'three/webgpu';

export type FloatNode = Node<'float'>;
export type Vec2Node = Node<'vec2'>;
export type Vec3Node = Node<'vec3'>;
export type Vec4Node = Node<'vec4'>;
export type ColorNode = Node<'color'>;

/** A `uniform(number)` — e.g. time, strengths, thresholds. */
export type FloatUniform = UniformNode<'float', number>;
