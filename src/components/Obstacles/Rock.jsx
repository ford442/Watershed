import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies } from '@react-three/rapier';

const ROCK_TYPES = ['boulder', 'slab', 'column'];

const displaceGeometry = (geometry, seed, amount = 0.18, yScale = 1) => {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const vertex = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    vertexNormal.fromBufferAttribute(normal, i);
    const wave = Math.sin(vertex.x * 3.7 + seed) + Math.cos(vertex.y * 4.9 - seed * 0.5) + Math.sin(vertex.z * 5.3 + seed * 1.7);
    vertex.addScaledVector(vertexNormal, (wave / 3) * amount);
    vertex.y *= yScale;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
};

export default function Rock({ transforms = [], scatterTransforms = [], material }) {
  const collidableRefs = useRef({});
  const scatterRefs = useRef({});

  const geometryLibrary = useMemo(() => {
    const boulder = displaceGeometry(new THREE.IcosahedronGeometry(1, 1), 0.7, 0.22, 0.95);

    const slab = displaceGeometry(new THREE.DodecahedronGeometry(1, 0), 1.9, 0.12, 0.42);
    slab.scale(1.45, 0.65, 1.15);
    slab.computeVertexNormals();

    const column = new THREE.CylinderGeometry(0.62, 0.82, 3.2, 7, 3);
    displaceGeometry(column, 3.3, 0.1, 1);
    column.translate(0, 1.6, 0);
    column.computeVertexNormals();

    const scree = displaceGeometry(new THREE.IcosahedronGeometry(0.35, 0), 4.2, 0.1, 0.75);

    return { boulder, slab, column, scree };
  }, []);

  const collidableGroups = useMemo(() => {
    const grouped = { boulder: [], slab: [], column: [] };
    transforms.forEach((t, i) => {
      const rockType = grouped[t.rockType] ? t.rockType : 'boulder';
      grouped[rockType].push({ key: `rock-${rockType}-${i}`, ...t });
    });
    return grouped;
  }, [transforms]);

  const scatterGroups = useMemo(() => {
    const grouped = { boulder: [], slab: [], column: [] };
    scatterTransforms.forEach((t, i) => {
      const rockType = grouped[t.rockType] ? t.rockType : 'boulder';
      grouped[rockType].push({ key: `scatter-${rockType}-${i}`, ...t });
    });
    return grouped;
  }, [scatterTransforms]);

  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();

    Object.entries(collidableGroups).forEach(([rockType, instances]) => {
      const mesh = collidableRefs.current[rockType];
      if (!mesh) return;
      instances.forEach((instance, index) => {
        quaternion.setFromEuler(instance.rotation);
        matrix.compose(instance.position, quaternion, instance.scale);
        mesh.setMatrixAt(index, matrix);
        if (instance.color) {
          color.set(instance.color);
          mesh.setColorAt(index, color);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });

    Object.entries(scatterGroups).forEach(([rockType, instances]) => {
      const mesh = scatterRefs.current[rockType];
      if (!mesh) return;
      instances.forEach((instance, index) => {
        quaternion.setFromEuler(instance.rotation);
        matrix.compose(instance.position, quaternion, instance.scale);
        mesh.setMatrixAt(index, matrix);
        if (instance.color) {
          color.set(instance.color);
          mesh.setColorAt(index, color);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [collidableGroups, scatterGroups]);

  if (transforms.length === 0 && scatterTransforms.length === 0) return null;

  return (
    <group>
      {ROCK_TYPES.map((rockType) => {
        const instances = collidableGroups[rockType];
        if (!instances.length) return null;

        return (
          <InstancedRigidBodies
            key={`rigid-${rockType}`}
            instances={instances}
            type="fixed"
            colliders={rockType === 'slab' ? 'cuboid' : 'hull'}
          >
            <instancedMesh
              ref={(node) => {
                if (node) collidableRefs.current[rockType] = node;
                else delete collidableRefs.current[rockType];
              }}
              args={[geometryLibrary[rockType], material, instances.length]}
              castShadow
              receiveShadow
            />
          </InstancedRigidBodies>
        );
      })}

      {ROCK_TYPES.map((rockType) => {
        const instances = scatterGroups[rockType];
        if (!instances.length) return null;

        return (
          <instancedMesh
            key={`scatter-${rockType}`}
            ref={(node) => {
              if (node) scatterRefs.current[rockType] = node;
              else delete scatterRefs.current[rockType];
            }}
            args={[geometryLibrary[rockType === 'column' ? 'scree' : rockType], material, instances.length]}
            castShadow
            receiveShadow
          />
        );
      })}
    </group>
  );
}
