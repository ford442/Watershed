import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';

const HIDDEN_POSITION = [0, -1000, 0];

function createRockGeometry() {
  const geometry = new THREE.DodecahedronGeometry(1, 1);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const vertex = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();

  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    vertexNormal.fromBufferAttribute(normal, index);
    const wave = Math.sin(vertex.x * 4.1) + Math.cos(vertex.y * 5.3) + Math.sin(vertex.z * 3.7);
    vertex.addScaledVector(vertexNormal, wave * 0.055);
    position.setXYZ(index, vertex.x, vertex.y * 0.82, vertex.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createLogGeometry() {
  const geometry = new THREE.CylinderGeometry(0.28, 0.34, 2.9, 8);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export default function PooledObstacles({ slots, rockMaterial }) {
  const rockMeshRef = useRef(null);
  const logMeshRef = useRef(null);
  const bodyRefs = useRef([]);

  const rockGeometry = useMemo(() => createRockGeometry(), []);
  const logGeometry = useMemo(() => createLogGeometry(), []);
  const logMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#7b6042',
    roughness: 0.92,
    metalness: 0,
  }), []);

  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const hiddenMatrix = new THREE.Matrix4().makeTranslation(...HIDDEN_POSITION);
    const quaternion = new THREE.Quaternion();
    const rockMesh = rockMeshRef.current;
    const logMesh = logMeshRef.current;

    let rockIndex = 0;
    let logIndex = 0;

    slots.forEach((slot, poolIndex) => {
      const active = slot.active && slot.position;
      const body = bodyRefs.current[poolIndex];
      if (body) {
        body.setTranslation(active ? slot.position : { x: HIDDEN_POSITION[0], y: HIDDEN_POSITION[1], z: HIDDEN_POSITION[2] }, true);
        if (active) {
          quaternion.setFromEuler(slot.rotation ?? new THREE.Euler());
          body.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
        } else {
          body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        }
      }

      quaternion.setFromEuler(slot.rotation ?? new THREE.Euler());
      matrix.compose(
        active ? slot.position : new THREE.Vector3(...HIDDEN_POSITION),
        quaternion,
        active ? slot.scale : new THREE.Vector3(0.001, 0.001, 0.001)
      );

      if (slot.type === 'log') {
        logMesh?.setMatrixAt(logIndex, matrix);
        logIndex += 1;
      } else {
        rockMesh?.setMatrixAt(rockIndex, matrix);
        rockIndex += 1;
      }
    });

    for (; rockIndex < slots.length; rockIndex += 1) {
      rockMesh?.setMatrixAt(rockIndex, hiddenMatrix);
    }
    for (; logIndex < slots.length; logIndex += 1) {
      logMesh?.setMatrixAt(logIndex, hiddenMatrix);
    }

    if (rockMesh) {
      rockMesh.count = slots.length;
      rockMesh.instanceMatrix.needsUpdate = true;
    }
    if (logMesh) {
      logMesh.count = slots.length;
      logMesh.instanceMatrix.needsUpdate = true;
    }
  }, [slots]);

  if (!slots?.length) return null;

  return (
    <group name="pooled-static-obstacles">
      <instancedMesh
        ref={rockMeshRef}
        args={[rockGeometry, rockMaterial, slots.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={logMeshRef}
        args={[logGeometry, logMaterial, slots.length]}
        castShadow
        receiveShadow
      />

      {slots.map((slot, index) => (
        <RigidBody
          key={`pooled-obstacle-${index}`}
          ref={(node) => {
            if (node) bodyRefs.current[index] = node;
            else delete bodyRefs.current[index];
          }}
          type="fixed"
          colliders={false}
          position={HIDDEN_POSITION}
        >
          <CuboidCollider
            args={[
              slot.colliderHalfExtents.x,
              slot.colliderHalfExtents.y,
              slot.colliderHalfExtents.z,
            ]}
            friction={slot.type === 'log' ? 0.65 : 0.9}
            restitution={0.05}
          />
        </RigidBody>
      ))}
    </group>
  );
}
