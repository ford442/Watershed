import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBiome } from '../../systems/biome/BiomeSystem';
import { SUN_DISTANCE, useSunPosition } from '../../systems/lighting/SunPositionSystem';

import type { BiomeDecorationTransform, WeatherAwareDecorationProps } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createSunShaftMaterial, createSunShaftMoteMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';
import { NonEmptyInstancedMesh } from '../NonEmptyInstancedMesh';
import { createRng } from '../../math/random';
import { useGameStore } from '../../systems/GameState';

/** This module's seeded stream (#503 A): draws are reproducible run to run. */
const random = createRng(0xdd9ac591);

const DUMMY_OBJ = new THREE.Object3D();
const DEFAULT_ROTATION = new THREE.Euler();
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);
const MOTES_PER_SHAFT = 6;
const MAX_DUST_SHAFTS = 24;

// Build a static GPU-driven dust mote field scattered through each shaft's
// cylindrical volume. Motion (rise + drift + twinkle) is computed entirely in
// the vertex shader from per-vertex attributes, so no per-frame CPU work.
const buildDustMotes = (transforms: BiomeDecorationTransform[]): THREE.BufferGeometry => {
  const shaftCount = Math.min(transforms.length, MAX_DUST_SHAFTS);
  const total = shaftCount * MOTES_PER_SHAFT;

  const basePositions = new Float32Array(total * 3);
  const heights = new Float32Array(total);
  const radii = new Float32Array(total);
  const phases = new Float32Array(total);
  const speeds = new Float32Array(total);

  const matrix = new THREE.Matrix4();
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();

  for (let s = 0; s < shaftCount; s++) {
    const t = transforms[s];
    matrix.compose(
      t.position,
      new THREE.Quaternion().setFromEuler(t.rotation || new THREE.Euler()),
      t.scale || new THREE.Vector3(1, 1, 1)
    );

    const shaftHeight = 30 * (t.scale?.y ?? 1);

    for (let m = 0; m < MOTES_PER_SHAFT; m++) {
      const idx = s * MOTES_PER_SHAFT + m;
      const a = random() * Math.PI * 2;
      const r = random() * 4; // within the wide base radius (cylinder bottom radius 6)
      const localY = (random() - 0.5) * 30; // cylinder spans -15..15 locally

      local.set(Math.cos(a) * r, localY, Math.sin(a) * r);
      world.copy(local).applyMatrix4(matrix);

      basePositions[idx * 3] = world.x;
      basePositions[idx * 3 + 1] = world.y;
      basePositions[idx * 3 + 2] = world.z;

      heights[idx] = shaftHeight;
      radii[idx] = 0.15 + random() * 0.35;
      phases[idx] = random() * Math.PI * 2;
      speeds[idx] = 0.3 + random() * 0.6;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(basePositions, 3));
  geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  return geo;
};

export default function SunShafts({
  transforms,
  flowSpeed = 1.0,
  isSlotCanyon = false,
}: WeatherAwareDecorationProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dustRef = useRef<THREE.InstancedMesh>(null);
  const motesRef = useRef<THREE.Points>(null);
  const { camera } = useThree();
  const { timeOfDay } = useBiome();
  const { sunDirection } = useSunPosition();
  const prevCamPosRef = useRef(new THREE.Vector3());
  const initialTimeOfDay = useRef(timeOfDay);
  const streakStrengthRef = useRef(0);
  const weatherType = useGameStore((s) => s.weather.type);


  // Geometry: Cone/Cylinder representing the light beam
  const geometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(2, 6, 30, 8, 1, true);
    return geo;
  }, []);

  // Custom Shader Material for Volumetric Light
  const material = useMemo(
    () =>
      createSunShaftMaterial(resolveMaterialBackend().backend, {
        flowSpeed,
        shaftOpacity: isSlotCanyon ? 0.5 : 0.3,
        colorBase: new THREE.Color('#fff6d8'),
        warmTint: new THREE.Color('#ffcc88'),
        timeOfDay: initialTimeOfDay.current,
      }),
    // timeOfDay is a per-frame uniform: a new hour must not rebuild (recompile) the material.
    [flowSpeed, isSlotCanyon],
  );

  const dustGeometry = useMemo(() => new THREE.PlaneGeometry(0.12, 1.0), []);
  const dustMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#fff4d0',
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  const moteGeometry = useMemo(() => (transforms ? buildDustMotes(transforms) : null), [transforms]);
  const moteMaterial = useMemo(
    () =>
      createSunShaftMoteMaterial(resolveMaterialBackend().backend, {
        colorBase: new THREE.Color('#fff6d8'),
        opacity: isSlotCanyon ? 0.55 : 0.35,
        flowSpeed,
      }),
    [flowSpeed, isSlotCanyon],
  );

  useFrame((state) => {
    const dt = Math.max(0.0001, state.clock.getDelta());
    const camDelta = camera.position.distanceTo(prevCamPosRef.current);
    prevCamPosRef.current.copy(camera.position);
    const cameraSpeed = camDelta / dt;
    const targetStreak = THREE.MathUtils.clamp(cameraSpeed / 30, 0, 1);
    streakStrengthRef.current = THREE.MathUtils.lerp(streakStrengthRef.current, targetStreak, 0.12);

    const overcastBlend = (weatherType === 'overcast' || weatherType === 'storm') ? 1 : weatherType === 'fog' ? 0.6 : 0;

    const shaftU = materialUniformBag(material);
    if (shaftU) {
      if (shaftU.time) shaftU.time.value = state.clock.elapsedTime;
      if (shaftU.flowSpeed) shaftU.flowSpeed.value = flowSpeed;
      if (shaftU.shaftOpacity) shaftU.shaftOpacity.value = isSlotCanyon ? 0.5 : 0.3;
      if (shaftU.timeOfDay) shaftU.timeOfDay.value = timeOfDay;
      if (shaftU.speedStreak) shaftU.speedStreak.value = streakStrengthRef.current;
      if (shaftU.sunDirection?.value instanceof THREE.Vector3) {
        shaftU.sunDirection.value.copy(sunDirection);
      }
      if (shaftU.overcastBlend) shaftU.overcastBlend.value = overcastBlend;
    }

    if (dustMaterial) {
      dustMaterial.opacity = (isSlotCanyon ? 0.2 : 0.12) + streakStrengthRef.current * 0.18 * (1 - overcastBlend * 0.6);
    }

    const moteU = materialUniformBag(moteMaterial);
    if (moteU) {
      if (moteU.time) moteU.time.value = state.clock.elapsedTime;
      if (moteU.flowSpeed) moteU.flowSpeed.value = flowSpeed;
      const sunFacing = THREE.MathUtils.clamp((sunDirection.y * SUN_DISTANCE) / 60, 0.25, 1.0);
      if (moteU.sunFacing) moteU.sunFacing.value = sunFacing * (1 - overcastBlend * 0.5);
    }
  }, 0);

  // Setup Instances
  useEffect(() => {
    const mesh = meshRef.current;
    const dustMesh = dustRef.current;
    if (!mesh || !transforms || transforms.length === 0) return;

    transforms.forEach((t: BiomeDecorationTransform, i: number) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation ?? DEFAULT_ROTATION);
      DUMMY_OBJ.scale.copy(t.scale ?? DEFAULT_SCALE);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
      if (dustMesh) {
        const dustScale = (t.scale ?? DEFAULT_SCALE).clone().multiply(new THREE.Vector3(0.18, 0.55, 0.18));
        DUMMY_OBJ.scale.copy(dustScale);
        DUMMY_OBJ.updateMatrix();
        dustMesh.setMatrixAt(i, DUMMY_OBJ.matrix);
      }
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (dustMesh) {
      dustMesh.instanceMatrix.needsUpdate = true;
    }
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      <NonEmptyInstancedMesh
        ref={meshRef}
        args={[geometry, material, transforms.length]}
        frustumCulled={false}
        renderOrder={1}
      />
      <NonEmptyInstancedMesh
        ref={dustRef}
        args={[dustGeometry, dustMaterial, transforms.length]}
        frustumCulled={false}
        renderOrder={2}
      />
      {moteGeometry && (
        <points ref={motesRef} geometry={moteGeometry} material={moteMaterial} frustumCulled={false} renderOrder={3} />
      )}
    </group>
  );
}
