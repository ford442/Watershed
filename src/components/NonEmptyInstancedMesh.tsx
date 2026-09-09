import { forwardRef, useCallback, useRef } from 'react';
import type * as THREE from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { useHideWhileEmpty } from '../hooks/useHideWhileEmpty';
import { instancedMeshCapacity } from './instanceGuards';

type InstancedMeshProps = ThreeElements['instancedMesh'];

/**
 * `<instancedMesh>` that never reaches a renderer with zero instances.
 *
 * three r168's node pipeline cannot compile a zero-count InstancedMesh, and one
 * such frame poisons that object's program for good — see
 * [`useHideWhileEmpty`](../hooks/useHideWhileEmpty.ts) for the mechanism. The
 * classic `WebGLRenderer` never cared, which is why this is invisible on
 * `?material=glsl`.
 *
 * Two layers, because instance counts arrive two different ways: an empty layer
 * is not mounted at all, and a pooled layer that empties at runtime is hidden
 * until it refills. The mesh starts hidden so the very first rendered frame is
 * safe regardless of when its owner assigns `count`.
 *
 * See also [`NonEmptyInstances`](./NonEmptyInstances.tsx) for drei `<Instances>`.
 */
export const NonEmptyInstancedMesh = forwardRef<THREE.InstancedMesh, InstancedMeshProps>(
  function NonEmptyInstancedMesh({ visible = true, ...props }, ref) {
    const meshRef = useRef<THREE.InstancedMesh | null>(null);
    useHideWhileEmpty(meshRef, visible);

    const attach = useCallback(
      (node: THREE.InstancedMesh | null) => {
        meshRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    if (!instancedMeshCapacity(props.args)) return null;

    return <instancedMesh ref={attach} visible={false} {...props} />;
  },
);
