import { useFrame } from '@react-three/fiber';
import type { RefObject } from 'react';
import type * as THREE from 'three';

/**
 * An InstancedMesh may only be rendered while it actually has instances.
 *
 * three r168's node pipeline cannot compile a zero-count InstancedMesh:
 * `InstanceNode.setup` builds the matrices as a UBO whenever `count <= 1000`,
 * and the GLSL backend prints the array size as `bufferCount > 0 ? bufferCount : ''`,
 * so zero emits `uniform NodeBuffer_N { mat4 bufferN[]; };` — an unsized array in
 * an interface block, which GLSL ES 3.00 rejects.
 */
export function resolveInstancedVisibility(count: number, declaredVisible: boolean): boolean {
  return declaredVisible && count > 0;
}

/**
 * Keeps an `InstancedMesh` out of the render list while it has no instances.
 *
 * The damage is permanent, which is what makes this a per-frame guard rather
 * than a mount-time check: rendering **one** frame at count 0 caches a broken
 * program for that object, and raising the count afterwards does not rebuild it
 * (verified in isolation — render at 0 then at 5 stays broken; hide at 0 and
 * show at 5 is clean). Pooled systems and drei's `<Instances>` both start at
 * zero and fill in later, so the first frame has to be skipped, not corrected.
 *
 * Skipping it is free: a zero-count InstancedMesh draws nothing anyway.
 */
export function useHideWhileEmpty(
  ref: RefObject<THREE.InstancedMesh | null>,
  declaredVisible = true,
): void {
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const wanted = resolveInstancedVisibility(mesh.count, declaredVisible);
    if (mesh.visible !== wanted) mesh.visible = wanted;
  });
}
