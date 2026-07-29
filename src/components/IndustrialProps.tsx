// src/components/IndustrialProps.tsx
// Concrete / metal props for Hydro-Dam — pipes, railings, catwalks, gates.

import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

export type IndustrialPropType = 'pipe' | 'railing' | 'catwalk' | 'gate';

interface IndustrialPropsProps {
  type: IndustrialPropType;
  positions: THREE.Vector3[];
  /** When true (WashedOut catwalks), hide washed-out span props. */
  washedOut?: boolean;
}

/**
 * IndustrialProps — Instanced static industrial set dressing.
 * Matrices are written once (no per-frame rebuild).
 */
export const IndustrialProps: React.FC<IndustrialPropsProps> = ({
  type,
  positions,
  washedOut = false,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    switch (type) {
      case 'pipe':
        return new THREE.CylinderGeometry(0.35, 0.35, 3.2, 10);
      case 'railing':
        return new THREE.BoxGeometry(0.08, 1.1, 2.4);
      case 'catwalk':
        return new THREE.BoxGeometry(2.6, 0.12, 6.5);
      case 'gate':
        return new THREE.BoxGeometry(3.2, 2.4, 0.18);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [type]);

  const material = useMemo(() => {
    const colors: Record<IndustrialPropType, string> = {
      pipe: '#4a5560',
      railing: '#3a4048',
      catwalk: '#5a6068',
      gate: '#2a3038',
    };
    return new THREE.MeshStandardMaterial({
      color: colors[type],
      roughness: type === 'gate' ? 0.45 : 0.7,
      metalness: type === 'pipe' || type === 'gate' ? 0.55 : 0.35,
    });
  }, [type]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || positions.length === 0) return;
    const dummy = new THREE.Object3D();
    positions.forEach((pos, i) => {
      dummy.position.copy(pos);
      if (type === 'pipe') {
        dummy.rotation.set(0, 0, Math.PI / 2);
      } else if (type === 'gate') {
        dummy.rotation.set(0, Math.PI * 0.08, 0);
      } else {
        dummy.rotation.set(0, 0, 0);
      }
      // Washed-out catwalks sink / vanish.
      if (washedOut && (type === 'catwalk' || type === 'railing')) {
        dummy.position.y -= 4;
        dummy.scale.set(0.01, 0.01, 0.01);
      } else {
        dummy.scale.set(1, 1, 1);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions, type, washedOut]);

  if (positions.length === 0) return null;
  if (washedOut && (type === 'catwalk' || type === 'railing')) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, positions.length]}
      castShadow
      receiveShadow
    />
  );
};

export default IndustrialProps;
