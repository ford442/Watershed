import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY = new THREE.Object3D();
const TEMP_POS = new THREE.Vector3();
const TEMP_FORWARD = new THREE.Vector3();
const TEMP_OFFSET = new THREE.Vector3();
const BASE_FORWARD = new THREE.Vector3(0, 0, 1);
const TEMP_UP = new THREE.Vector3(0, 1, 0);
const TEMP_QUAT = new THREE.Quaternion();
const LEFT_FLAP_QUAT = new THREE.Quaternion();
const RIGHT_FLAP_QUAT = new THREE.Quaternion();
const MAX_BATS = 12;

const hash = (n) => {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
};

const cubicBezier = (target, p0, p1, p2, p3, out) => {
  const inv = 1 - target;
  const inv2 = inv * inv;
  const inv3 = inv2 * inv;
  const t2 = target * target;
  const t3 = t2 * target;

  out.set(
    inv3 * p0.x + 3 * inv2 * target * p1.x + 3 * inv * t2 * p2.x + t3 * p3.x,
    inv3 * p0.y + 3 * inv2 * target * p1.y + 3 * inv * t2 * p2.y + t3 * p3.y,
    inv3 * p0.z + 3 * inv2 * target * p1.z + 3 * inv * t2 * p2.z + t3 * p3.z
  );
  return out;
};

const createWingGeometry = (side) => {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    0, 0, 0,
    side * 0.34, 0.02, -0.08,
    side * 0.28, -0.01, -0.2,
    side * 0.16, 0.015, -0.3,
    side * 0.06, 0, -0.14,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  geo.computeVertexNormals();
  return geo;
};

const chooseNextPath = (bat, seedBias = 0) => {
  const seed = bat.seed + bat.hopCount * 17.0 + seedBias;
  const lateral = (hash(seed + 1.3) - 0.5) * bat.rangeX;
  const forward = (hash(seed + 2.6) - 0.5) * bat.rangeZ;
  const targetY = bat.waterLevel + 2 + hash(seed + 3.9) * 2.0;
  const target = new THREE.Vector3(
    bat.origin.x + lateral,
    targetY,
    bat.origin.z + forward
  );

  const span = target.clone().sub(bat.current);
  const tangent = span.clone().normalize();
  const side = new THREE.Vector3().crossVectors(tangent, TEMP_UP).normalize();
  const arcHeight = 0.3 + hash(seed + 5.2) * 0.9;
  const sideDrift = (hash(seed + 6.7) - 0.5) * 1.2;

  bat.p0.copy(bat.current);
  bat.p1.copy(bat.current).addScaledVector(tangent, bat.current.distanceTo(target) * 0.28).addScaledVector(side, sideDrift);
  bat.p1.y += arcHeight;
  bat.p2.copy(target).addScaledVector(tangent, -bat.current.distanceTo(target) * 0.22).addScaledVector(side, -sideDrift * 0.55);
  bat.p2.y += arcHeight * 0.35;
  bat.p3.copy(target);

  bat.progress = 0;
  bat.duration = 0.38 + hash(seed + 7.4) * 0.55;
  bat.hopCount += 1;
};

export default function Bats({ transforms, visible = false, waterLevel = 0.5 }) {
  const bodyRef = useRef();
  const leftWingRef = useRef();
  const rightWingRef = useRef();

  const activeTransforms = useMemo(
    () => (Array.isArray(transforms) ? transforms.slice(0, MAX_BATS) : []),
    [transforms]
  );

  const bats = useMemo(() => {
    return activeTransforms.map((transform, index) => {
      const basePos = transform.position || new THREE.Vector3();
      const seed = basePos.x * 11.7 + basePos.z * 4.3 + index * 23.1;
      const scale = 0.24 + hash(seed + 0.9) * 0.14;
      const origin = new THREE.Vector3(basePos.x, basePos.y, basePos.z);
      const current = origin.clone();

      const bat = {
        seed,
        scale,
        flapFreq: 7.5 + hash(seed + 2.2) * 2.5,
        flapAmp: 0.68 + hash(seed + 3.7) * 0.35,
        phase: hash(seed + 4.5) * Math.PI * 2,
        rangeX: 5.5 + hash(seed + 6.1) * 6.5,
        rangeZ: 5.5 + hash(seed + 7.3) * 6.5,
        origin,
        current,
        waterLevel,
        p0: current.clone(),
        p1: current.clone(),
        p2: current.clone(),
        p3: current.clone(),
        progress: 0,
        duration: 0.6,
        hopCount: 0,
      };
      chooseNextPath(bat, 10.0);
      return bat;
    });
  }, [activeTransforms, waterLevel]);

  const bodyGeometry = useMemo(() => {
    const geo = new THREE.CapsuleGeometry(0.03, 0.1, 3, 6);
    geo.rotateX(Math.PI / 2);
    return geo;
  }, []);
  const leftWingGeometry = useMemo(() => createWingGeometry(1), []);
  const rightWingGeometry = useMemo(() => createWingGeometry(-1), []);

  const bodyMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#1a1010',
      emissive: '#111622',
      emissiveIntensity: 0.12,
      roughness: 0.9,
      metalness: 0,
    });
  }, []);
  const wingMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#231618',
      emissive: '#10172a',
      emissiveIntensity: 0.08,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }, []);

  useFrame(({ clock }, delta) => {
    if (!visible || !bodyRef.current || !leftWingRef.current || !rightWingRef.current || bats.length === 0) return;

    const now = clock.elapsedTime;
    bats.forEach((bat, index) => {
      bat.progress += delta / Math.max(0.12, bat.duration);
      if (bat.progress >= 1) {
        bat.current.copy(bat.p3);
        chooseNextPath(bat, now * 0.19);
      }

      const t = THREE.MathUtils.clamp(bat.progress, 0, 1);
      cubicBezier(t, bat.p0, bat.p1, bat.p2, bat.p3, TEMP_POS);
      const lookAheadT = Math.min(1, t + 0.07);
      cubicBezier(lookAheadT, bat.p0, bat.p1, bat.p2, bat.p3, TEMP_FORWARD);
      TEMP_FORWARD.sub(TEMP_POS);
      if (TEMP_FORWARD.lengthSq() < 1e-5) {
        TEMP_FORWARD.copy(BASE_FORWARD);
      } else {
        TEMP_FORWARD.normalize();
      }

      TEMP_QUAT.setFromUnitVectors(BASE_FORWARD, TEMP_FORWARD);

      DUMMY.position.copy(TEMP_POS);
      DUMMY.quaternion.copy(TEMP_QUAT);
      DUMMY.scale.setScalar(bat.scale);
      DUMMY.updateMatrix();
      bodyRef.current.setMatrixAt(index, DUMMY.matrix);

      const flap = Math.sin(now * bat.flapFreq * Math.PI * 2 + bat.phase) * bat.flapAmp;
      LEFT_FLAP_QUAT.setFromAxisAngle(BASE_FORWARD, flap);
      RIGHT_FLAP_QUAT.setFromAxisAngle(BASE_FORWARD, -flap);

      TEMP_OFFSET.set(-0.025, 0.012, -0.005).applyQuaternion(TEMP_QUAT);
      DUMMY.position.copy(TEMP_POS).add(TEMP_OFFSET);
      DUMMY.quaternion.copy(TEMP_QUAT).multiply(LEFT_FLAP_QUAT);
      DUMMY.scale.setScalar(bat.scale);
      DUMMY.updateMatrix();
      leftWingRef.current.setMatrixAt(index, DUMMY.matrix);

      TEMP_OFFSET.set(0.025, 0.012, -0.005).applyQuaternion(TEMP_QUAT);
      DUMMY.position.copy(TEMP_POS).add(TEMP_OFFSET);
      DUMMY.quaternion.copy(TEMP_QUAT).multiply(RIGHT_FLAP_QUAT);
      DUMMY.scale.setScalar(bat.scale);
      DUMMY.updateMatrix();
      rightWingRef.current.setMatrixAt(index, DUMMY.matrix);

      bat.current.copy(TEMP_POS);
    });

    bodyRef.current.instanceMatrix.needsUpdate = true;
    leftWingRef.current.instanceMatrix.needsUpdate = true;
    rightWingRef.current.instanceMatrix.needsUpdate = true;
  });

  if (!visible || bats.length === 0) return null;

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[bodyGeometry, bodyMaterial, bats.length]} frustumCulled={false} />
      <instancedMesh ref={leftWingRef} args={[leftWingGeometry, wingMaterial, bats.length]} frustumCulled={false} />
      <instancedMesh ref={rightWingRef} args={[rightWingGeometry, wingMaterial, bats.length]} frustumCulled={false} />
    </group>
  );
}
