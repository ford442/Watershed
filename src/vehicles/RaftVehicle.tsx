import React, { useRef, useEffect, forwardRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { RaftVehicle as RaftVehicleClass, SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/VehicleSystem';
import { CollisionParticles } from '../components/CollisionParticles';
import { PLAYER_SPAWN } from '../constants/game';
import { createRapierWorkerProxy } from '../physics/createRapierWorkerProxy';
import type { RapierWorkerProxy } from '../physics/RapierWorkerProxy';
import type { WorkerRaftState } from '../physics/rapierWorkerProtocol';
import { usePlayerControls } from '../hooks/usePlayerControls';
import { WATER_PHYSICS } from './RaftVehicle/constants';
import { useRaftPhysicsState } from './RaftVehicle/hooks/useRaftPhysicsState';
import { useRaftControls } from './RaftVehicle/hooks/useRaftControls';
import { computeShelfTrigger } from './utils/shelfLaunch';

const RaftVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const raftMaterialRef = useRef<any>(null);
  const { camera } = useThree();
  const { world } = useRapier();
  const useWorkerPhysics = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('raftWorker') === '1';

  const controls = usePlayerControls();
  const raftVehicle = useRef(new RaftVehicleClass());

  const workerProxyRef = useRef<RapierWorkerProxy | null>(null);
  const workerReadyRef = useRef(false);
  const workerStepPendingRef = useRef(false);

  const physicsState = useRaftPhysicsState();
  const {
    buoyancyState, tippingState, paddleState, staminaState, stunState,
    forwardBiasState, shedParticles, collisionState, sharedPhysicsState, lastWorkerSync
  } = physicsState;

  // Waterfall launch-shelf v2: cache segment-14 spawn point and one-shot flag.
  const shelfSpawnPointRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const shelfLaunchFiredRef = useRef(false);
  const shelfTriggerRef = useRef<ReturnType<typeof computeShelfTrigger>>(null);

  React.useImperativeHandle(forwardedRef, () => bodyRef.current);

  const syncBodyFromWorkerState = (body: any, workerState: WorkerRaftState | null) => {
    if (!body || !workerState) return;
    const [px, py, pz] = workerState.position;
    const [rx, ry, rz, rw] = workerState.rotation;
    const [vx, vy, vz] = workerState.velocity;
    const [avx, avy, avz] = workerState.angularVelocity;
    body.setTranslation({ x: px, y: py, z: pz }, true);
    body.setRotation({ x: rx, y: ry, z: rz, w: rw }, true);
    body.setLinvel({ x: vx, y: vy, z: vz }, true);
    body.setAngvel({ x: avx, y: avy, z: avz }, true);
  };

  const applyWorkerImpulse = (impulse: THREE.Vector3) => {
    const proxy = workerProxyRef.current;
    if (!proxy || !workerReadyRef.current) return;
    proxy.applyImpulse([impulse.x, impulse.y, impulse.z]).catch((error) => {
      console.warn('[RaftVehicle] Rapier worker impulse failed', error);
    });
  };

  const stepWorkerProxy = (body: any, delta: number) => {
    const proxy = workerProxyRef.current;
    if (!proxy || !workerReadyRef.current || workerStepPendingRef.current) return;

    workerStepPendingRef.current = true;
    const pos = body.translation();
    const rot = body.rotation();
    const vel = body.linvel();
    const angvel = body.angvel();

    proxy.step({
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z, rot.w],
      velocity: [vel.x, vel.y, vel.z],
      angularVelocity: [angvel.x, angvel.y, angvel.z],
    }, delta).then((workerState) => {
      if (workerState) syncBodyFromWorkerState(bodyRef.current, workerState);
    }).finally(() => {
      workerStepPendingRef.current = false;
    });
  };

  useEffect(() => {
    if (bodyRef.current) {
      raftVehicle.current.initialize(bodyRef.current, new THREE.Vector3(...PLAYER_SPAWN.position));
      raftVehicle.current.setSurfaceMaterial(SurfaceMaterial.WATER);
      if (useWorkerPhysics) {
        const proxy = createRapierWorkerProxy();
        workerProxyRef.current = proxy;
        proxy.init({
          raft: {
            position: [...PLAYER_SPAWN.position],
            halfExtents: [WATER_PHYSICS.RAFT_WIDTH * 0.5, WATER_PHYSICS.RAFT_HEIGHT * 0.5, WATER_PHYSICS.RAFT_LENGTH * 0.5],
            mass: WATER_PHYSICS.RAFT_MASS,
            linearDamping: 2,
            angularDamping: 2.5,
          },
          staticColliders: [
            {
              position: [0, WATER_PHYSICS.LEVEL - 0.65, -80],
              halfExtents: [28, 0.25, 220],
            },
          ],
        }).then((workerState) => {
          workerReadyRef.current = true;
          syncBodyFromWorkerState(bodyRef.current, workerState);
          return proxy.applyImpulse([0, 2, 0]);
        }).catch((error) => {
          console.warn('[RaftVehicle] Rapier worker init failed; using main-thread physics', error);
          workerReadyRef.current = false;
          workerProxyRef.current?.dispose();
          workerProxyRef.current = null;
          bodyRef.current?.applyImpulse?.({ x: 0, y: 2, z: 0 }, true);
        });
      } else {
        bodyRef.current.applyImpulse({ x: 0, y: 2, z: 0 }, true);
      }
      tippingState.current.lastSafePosition.copy(bodyRef.current.translation());
    }

    const handleBiomeChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const biome = customEvent.detail?.biome || 'summer';
      collisionState.current.currentBiome = biome;
      const material = MATERIAL_FROM_BIOME[biome] || SurfaceMaterial.WATER;
      raftVehicle.current.setSurfaceMaterial(material);
    };

    window.addEventListener('biome-change', handleBiomeChange);

    const handleSegmentSpawn = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { segmentIndex, spawnPoint } = customEvent.detail ?? {};
      if (segmentIndex === 14 && spawnPoint) {
        shelfSpawnPointRef.current = spawnPoint;
        shelfTriggerRef.current = computeShelfTrigger(spawnPoint);
      }
    };
    window.addEventListener('segment-spawn', handleSegmentSpawn);

    return () => {
      window.removeEventListener('biome-change', handleBiomeChange);
      window.removeEventListener('segment-spawn', handleSegmentSpawn);
      workerProxyRef.current?.dispose();
      workerProxyRef.current = null;
    };
  }, [useWorkerPhysics]);

  useRaftControls({
    bodyRef, raftVehicle, camera, controls, workerProxy: workerProxyRef.current,
    buoyancyState, tippingState, paddleState, staminaState,
    stunState, forwardBiasState, shedParticles, collisionState,
    lastWorkerSync, sharedPhysicsState, raftMaterialRef, useWorkerPhysics, applyWorkerImpulse, stepWorkerProxy,
    shelfLaunchFiredRef, shelfTriggerRef
  });

  return (
    <group>
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        mass={150}
        restitution={0.4}
        linearDamping={2.0}
        angularDamping={2.5}
        position={PLAYER_SPAWN.position}
      >
        <mesh castShadow receiveShadow>
          <boxGeometry args={[WATER_PHYSICS.RAFT_WIDTH, WATER_PHYSICS.RAFT_HEIGHT, WATER_PHYSICS.RAFT_LENGTH]} />
          <meshStandardMaterial
            ref={raftMaterialRef}
            color="saddlebrown"
            roughness={0.6}
            metalness={0.1}
          />
        </mesh>

        <mesh position={[0, WATER_PHYSICS.RAFT_HEIGHT * 0.5 + 0.1, 0]}>
          <boxGeometry args={[WATER_PHYSICS.RAFT_WIDTH * 0.8, 0.2, WATER_PHYSICS.RAFT_LENGTH * 0.8]} />
          <meshStandardMaterial color="#443322" />
        </mesh>

        {/* Bounced-light catch from the water surface — gives the hull a
            believable cool wet-rim glow along the waterline. */}
        <pointLight
          position={[0, -0.15, 0]}
          color="#bcdfff"
          intensity={0.6}
          distance={3}
          decay={2}
        />
      </RigidBody>

      {paddleState.current.foamParticles.map(particle => (
        <mesh key={particle.id} position={particle.position}>
          <sphereGeometry args={[0.15 + Math.random() * 0.1, 8, 8]} />
          <meshBasicMaterial
            color="white"
            transparent
            opacity={particle.life / PADDLE.FOAM_LIFETIME}
            depthWrite={false}
          />
        </mesh>
      ))}

      {shedParticles.current.map(particle => (
        <mesh key={particle.id} position={particle.position}>
          <sphereGeometry args={[particle.scale, 8, 8]} />
          <meshBasicMaterial
            color="#e0f0ff"
            transparent
            opacity={(particle.life / SHED.LIFETIME) * 0.6}
            depthWrite={false}
          />
        </mesh>
      ))}

      {collisionState.current.activeParticles.map(particle => (
        <CollisionParticles
          key={particle.id}
          material={particle.material}
          position={particle.position}
          intensity={particle.intensity}
          onComplete={() => {
            collisionState.current.activeParticles = collisionState.current.activeParticles.filter(p => p.id !== particle.id);
          }}
        />
      ))}
    </group>
  );
});

export default RaftVehicle;
