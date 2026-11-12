import React, { useRef, useEffect, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { COLLISION_PARTICLE_CAPACITY, ParticlePoolMesh } from '../components/CollisionParticles';
import { ParticlePool } from '../components/particlePool';
import { PLAYER_SPAWN } from '../constants/game';
import { createRunnerPhysicsState } from './RunnerVehicle/hooks/runnerPhysicsState';
import { subscribeRunnerCues } from './RunnerVehicle/runnerCues';
import { createRunnerSimSystem } from './RunnerVehicle/runnerSimSystem';
import { syncRunnerCamera } from './RunnerVehicle/runnerCameraSync';
import { updateRunnerFovKick } from './RunnerVehicle/runnerFovKick';
import { simCore } from '../sim/core/SimCore';
import { useGameStore } from '../systems/GameState';
import { computeShelfTrigger } from './utils/shelfLaunch';
import { gameEvents } from '../systems/events/GameEvents';
import { queryFlags } from '../config/queryFlags';

const isNoPointerLock = queryFlags().noPointerLock;

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

/** The FOV kick's argument object, rewritten per frame (#521 D). */
const fovArgs = {} as Parameters<typeof updateRunnerFovKick>[0];

const RunnerVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<RapierRigidBody>(null);
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  // Stable per mount: @react-three/rapier re-applies `userData` (replacing the
  // object) whenever its identity changes, and the physics step keeps its boot
  // latches (__terrainReady, __holdTarget, …) on it. A fresh literal per render
  // wiped them, so any re-render while airborne snapped the runner to spawn.
  const playerUserData = useMemo(() => ({ isPlayer: true }), []);

  const [state] = useState(createRunnerPhysicsState);
  const { collisionState } = state;
  // Collision bursts: presentation, fed by the step's `vehicle-impact` cue (#556 A).
  const [particles] = useState(() => new ParticlePool(COLLISION_PARTICLE_CAPACITY));
  useEffect(() => subscribeRunnerCues(particles), [particles]);

  // Waterfall launch-shelf v2: cache segment-14 spawn point and one-shot flag.
  const shelfSpawnPointRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const shelfLaunchFiredRef = useRef(false);
  const shelfTriggerRef = useRef<ReturnType<typeof computeShelfTrigger>>(null);

  useImperativeHandle(forwardedRef, () => bodyRef.current as RapierRigidBody);

  useEffect(() => {
    if (bodyRef.current) {
      const [x, y, z] = PLAYER_SPAWN.position;
      bodyRef.current.setTranslation({ x, y, z }, true);
    }

    // Footstep timbre follows the biome (audio).
    const offBiomeChange = gameEvents.on('biome-change', ({ biome }) => {
      collisionState.current.currentBiome = biome;
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
    // collisionState is created once per mount (useRunnerPhysicsState's lazy state).
  }, [collisionState]);

  // The step is SimCore's `vehicle-runner` system for this mount (#556 A): it
  // runs at the fixed sim step with the hub's frame, not in a useFrame.
  useEffect(
    () =>
      simCore.register(
        createRunnerSimSystem({
          world,
          rapier,
          getBody: () => bodyRef.current,
          // The runner is first-person: R3F's default camera is a PerspectiveCamera.
          camera: camera as THREE.PerspectiveCamera,
          vehicleState: state,
          shelfLaunchFiredRef,
          shelfTriggerRef,
        }),
      ),
    [world, rapier, camera, state],
  );

  // The camera onto the body and the speed FOV kick, once per frame where the
  // step used to run (and, as there, only after a step that reached its camera stage).
  useFrame((_frame, delta) => {
    const body = bodyRef.current;
    if (!body || !state.stepScratch.followCamera) return;
    const cam = camera as THREE.PerspectiveCamera;
    syncRunnerCamera(cam, body, state);
    const fa = fovArgs;
    fa.camera = cam;
    fa.vel = body.linvel();
    fa.dt = delta;
    fa.fovState = state.fovState;
    fa.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
    updateRunnerFovKick(fa);
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
      <ParticlePoolMesh pool={particles} />
    </>
  );
});

export default RunnerVehicle;
