import { useRunnerControls } from './RunnerVehicle/hooks/useRunnerControls';
import React, { useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, type RapierRigidBody } from '@react-three/rapier';
import { usePlayerControls } from '../hooks/usePlayerControls';
import * as THREE from 'three';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/vehicle/VehicleSystem';
import { ParticlePoolMesh } from '../components/CollisionParticles';
import { PLAYER_SPAWN } from '../constants/game';
import { useRunnerPhysicsState } from './RunnerVehicle/hooks/useRunnerPhysics';
import { computeShelfTrigger } from './utils/shelfLaunch';
import { gameEvents } from '../systems/events/GameEvents';
import { queryFlags } from '../config/queryFlags';

const isNoPointerLock = queryFlags.noPointerLock;

function HeadlessPlayerMarker({ bodyRef }: { bodyRef: React.RefObject<RapierRigidBody | null> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (meshRef.current && bodyRef.current) {
      const pos = bodyRef.current.translation();
      meshRef.current.position.set(pos.x, pos.y, pos.z);
    }
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[2.5, 16, 16]} />
      <meshBasicMaterial color="#ff2a6d" />
    </mesh>
  );
}

const RunnerVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<RapierRigidBody>(null);
  const { camera } = useThree();
  const controls = usePlayerControls(camera);
  // Stable per mount: @react-three/rapier re-applies `userData` (replacing the
  // object) whenever its identity changes, and the physics step keeps its boot
  // latches (__terrainReady, __holdTarget, …) on it. A fresh literal per render
  // wiped them, so any re-render while airborne snapped the runner to spawn.
  const playerUserData = useMemo(() => ({ isPlayer: true }), []);

  const state = useRunnerPhysicsState();
  const { vehicle, collisionState } = state;

  // Waterfall launch-shelf v2: cache segment-14 spawn point and one-shot flag.
  const shelfSpawnPointRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const shelfLaunchFiredRef = useRef(false);
  const shelfTriggerRef = useRef<ReturnType<typeof computeShelfTrigger>>(null);

  useImperativeHandle(forwardedRef, () => bodyRef.current as RapierRigidBody);

  useEffect(() => {
    if (bodyRef.current) {
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(...PLAYER_SPAWN.position));
      // Set initial material
      vehicle.current.setSurfaceMaterial(SurfaceMaterial.ROCK);
    }
    
    // Listen for biome changes
    const offBiomeChange = gameEvents.on('biome-change', ({ biome }) => {
      collisionState.current.currentBiome = biome;
      const material = MATERIAL_FROM_BIOME[biome] || SurfaceMaterial.ROCK;
      vehicle.current.setSurfaceMaterial(material);
    });

    const offSegmentSpawn = gameEvents.on('segment-spawn', ({ segmentIndex, spawnPoint }) => {
      if (segmentIndex === 14) {
        shelfSpawnPointRef.current = spawnPoint;
        shelfTriggerRef.current = computeShelfTrigger(spawnPoint);
      }
    });

    return () => {
      offBiomeChange();
      offSegmentSpawn();
    };
  }, []);

  useRunnerControls({
    bodyRef, camera, controls, vehicleState: state,
    shelfLaunchFiredRef, shelfTriggerRef
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        colliders={false}
        position={PLAYER_SPAWN.position}
        mass={75}
        friction={0.04}
        restitution={0.15}
        linearDamping={0.35}
        angularDamping={0.9}
        userData={playerUserData}
      >
        <CapsuleCollider args={[0.4, 0.5]} />
      </RigidBody>

      {isNoPointerLock && <HeadlessPlayerMarker bodyRef={bodyRef} />}
      
      {/* Collision particle effects (stepped and drawn in useFrame, not by re-render) */}
      <ParticlePoolMesh pool={collisionState.current.particles} />
    </>
  );
});

export default RunnerVehicle;
