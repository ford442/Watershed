import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { TreeSystemProps } from './Environment/types';

/**
 * TreeSystem - Instanced tree rendering along riverbanks
 *
 * Generates trees positioned along the river path with natural distribution.
 * Uses instanced rendering for performance with many trees.
 */

const TRUNK_ROTATION_X = Math.PI / 2;

interface TreeInstance {
  position: THREE.Vector3;
  scale: number;
  rotation: number;
}

export default function TreeSystem({
  riverPath,
  trackWidth = 16,
  wallHeight = 12,
}: TreeSystemProps) {
  const treeData = useMemo((): TreeInstance[] => {
    if (!riverPath) return [];

    const trees: TreeInstance[] = [];
    const numSamples = 50;
    const treesPerSide = 3;

    for (let i = 0; i < numSamples; i++) {
      const t = i / numSamples;
      const point = riverPath.getPoint(t);
      const tangent = riverPath.getTangent(t).normalize();

      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

      for (let side = -1; side <= 1; side += 2) {
        for (let j = 0; j < treesPerSide; j++) {
          const offsetFromWall = Math.random() * 3 + 1;
          const lateralOffset = Math.random() * 2 - 1;

          const baseDistance = (trackWidth / 2) + offsetFromWall;
          const position = point.clone()
            .add(right.clone().multiplyScalar(side * baseDistance))
            .add(tangent.clone().multiplyScalar(lateralOffset * 5));

          position.y += wallHeight;

          trees.push({
            position,
            scale: 0.5 + Math.random() * 0.5,
            rotation: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    return trees;
  }, [riverPath, trackWidth, wallHeight]);

  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const foliageRef = useRef<THREE.InstancedMesh>(null);

  const trunkGeometry = useMemo(() => new THREE.CylinderGeometry(0.2, 0.2, 2, 8), []);
  const foliageGeometry = useMemo(() => new THREE.ConeGeometry(1, 3, 8), []);
  const trunkMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#3d2817', roughness: 0.8 }),
    [],
  );
  const foliageMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2d5016', roughness: 0.7 }),
    [],
  );

  useEffect(() => {
    const trunkMesh = trunkRef.current;
    const foliageMesh = foliageRef.current;
    if (!trunkMesh || !foliageMesh || treeData.length === 0) return;

    const trunkMatrix = new THREE.Matrix4();
    const foliageMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    treeData.forEach((tree, i) => {
      const { position: treePos, scale: treeScale, rotation } = tree;

      const trunkHeight = 2 * treeScale;
      position.set(treePos.x, treePos.y + trunkHeight / 2, treePos.z);
      quaternion.setFromEuler(new THREE.Euler(TRUNK_ROTATION_X, 0, 0));
      scale.set(0.2 * treeScale, 0.2 * treeScale, trunkHeight);
      trunkMatrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(i, trunkMatrix);

      position.set(treePos.x, treePos.y + trunkHeight + 1.5 * treeScale, treePos.z);
      quaternion.setFromEuler(new THREE.Euler(0, rotation, 0));
      scale.set(treeScale, treeScale * 1.5, treeScale);
      foliageMatrix.compose(position, quaternion, scale);
      foliageMesh.setMatrixAt(i, foliageMatrix);
    });

    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;
  }, [treeData]);

  if (treeData.length === 0) return null;

  return (
    <group name="tree-system">
      <instancedMesh
        ref={trunkRef}
        args={[trunkGeometry, trunkMaterial, treeData.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={foliageRef}
        args={[foliageGeometry, foliageMaterial, treeData.length]}
        castShadow
        receiveShadow
      />
    </group>
  );
}
