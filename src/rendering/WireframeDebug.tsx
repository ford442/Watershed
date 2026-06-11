/**
 * Scene-wide wireframe overlay for geometry debugging.
 * Restores original material wireframe flags when disabled.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

type MaterialSnapshot = { wireframe: boolean };

function snapshotMaterial(mat: THREE.Material): MaterialSnapshot {
  return { wireframe: 'wireframe' in mat ? !!(mat as THREE.MeshStandardMaterial).wireframe : false };
}

function applyWireframe(mat: THREE.Material, enabled: boolean): void {
  if ('wireframe' in mat) {
    (mat as THREE.MeshStandardMaterial).wireframe = enabled;
    mat.needsUpdate = true;
  }
}

function forEachMaterial(
  material: THREE.Material | THREE.Material[],
  fn: (mat: THREE.Material) => void
): void {
  if (Array.isArray(material)) {
    material.forEach(fn);
  } else {
    fn(material);
  }
}

export interface WireframeDebugProps {
  enabled: boolean;
}

export default function WireframeDebug({ enabled }: WireframeDebugProps) {
  const { scene } = useThree();
  const snapshots = useRef(new WeakMap<THREE.Material, MaterialSnapshot>());

  useEffect(() => {
    const touched = new Set<THREE.Material>();

    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      forEachMaterial(mesh.material, (mat) => {
        if (!snapshots.current.has(mat)) {
          snapshots.current.set(mat, snapshotMaterial(mat));
        }
        applyWireframe(mat, enabled);
        touched.add(mat);
      });
    });

    return () => {
      if (!enabled) return;
      touched.forEach((mat) => {
        const original = snapshots.current.get(mat);
        if (original) applyWireframe(mat, original.wireframe);
      });
    };
  }, [enabled, scene]);

  return null;
}
