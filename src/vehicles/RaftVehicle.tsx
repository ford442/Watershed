import React, { useRef, useEffect, forwardRef } from 'react';
import { useThree } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { RaftVehicle as RaftVehicleClass, SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/vehicle/VehicleSystem';
import { ParticlePoolMesh } from '../components/CollisionParticles';
import { PLAYER_SPAWN } from '../constants/game';
import { createRapierWorkerProxy } from '../physics/createRapierWorkerProxy';
import { buildRaftWorkerWaterForceConfig } from '../physics/physicsWorkerConfig';
import { computeHullMirrorForce } from '../physics/hullMirrorForce';
import {
  getPhysicsWorkerTickParams,
  setPhysicsWorkerActive,
  setPhysicsWorkerDecision,
  setPhysicsWorkerDiagnostics,
} from '../physics/physicsWorkerRegistry';
import type { RapierWorkerProxy } from '../physics/RapierWorkerProxy';
import type { Vec3Tuple, WorkerRaftState } from '../physics/rapierWorkerProtocol';
import { resolvePhysicsWorker } from '../utils/physicsWorkerFlag';
import { linkPhysicsToSim } from '../sim/linkPhysicsToSim';
import { startRaftWorkerSession, type RaftWorkerSession } from './RaftVehicle/raftWorkerSession';
import { useSettingsStore } from '../systems/settings/useSettingsStore';
import { usePlayerControls } from '../hooks/usePlayerControls';
import { WATER_PHYSICS } from './RaftVehicle/constants';
import { useRaftPhysicsState } from './RaftVehicle/hooks/useRaftPhysicsState';
import { useRaftControls } from './RaftVehicle/hooks/useRaftControls';
import { computeShelfTrigger } from './utils/shelfLaunch';

const RaftVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const raftMaterialRef = useRef<any>(null);
  const { camera } = useThree();
  // Default-on: the worker runs unless the browser can't host it, the player
  // turned it off, or ?physicsWorker=0 is set. Read once per mount — switching
  // mid-session would strand the Rapier body between two authorities.
  const physicsWorkerPreference = useSettingsStore((s) => s.physicsWorker);
  const workerDecision = React.useMemo(
    () => resolvePhysicsWorker({ preference: physicsWorkerPreference }),
    [physicsWorkerPreference],
  );
  const useWorkerPhysics = workerDecision.enabled;

  useEffect(() => {
    setPhysicsWorkerDecision(workerDecision.enabled, workerDecision.reason);
  }, [workerDecision]);

  const controls = usePlayerControls();
  const raftVehicle = useRef(new RaftVehicleClass());

  const workerProxyRef = useRef<RapierWorkerProxy | null>(null);
  const workerReadyRef = useRef(false);
  const workerStepPendingRef = useRef(false);

  const physicsState = useRaftPhysicsState();
  const {
    buoyancyState, tippingState, paddleState, staminaState, stunState,
    forwardBiasState, foamParticles, shedParticles, collisionState,
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

  const stepWorkerProxy = (body: any, delta: number, impulses: Vec3Tuple[] = []) => {
    const proxy = workerProxyRef.current;
    if (!proxy || !workerReadyRef.current || workerStepPendingRef.current) return;

    workerStepPendingRef.current = true;
    const tickParams = getPhysicsWorkerTickParams();
    const waterForceConfig = buildRaftWorkerWaterForceConfig(
      tickParams,
      performance.now() / 1000,
      true,
    );
    // The TS mirror for the state this step starts from (the body mirrors the
    // worker's last post-step state). The worker applies it only when the hull
    // link has no fresh sim-worker force (#467).
    const waterForce = {
      ...waterForceConfig,
      mirror: computeHullMirrorForce(
        { position: body.translation(), velocity: body.linvel() },
        waterForceConfig,
      ),
    };

    proxy.step(delta, { impulses, waterForce }).then(({ state: workerState, waterForce: diagnostics }) => {
      if (workerState) syncBodyFromWorkerState(bodyRef.current, workerState);
      if (diagnostics) {
        setPhysicsWorkerDiagnostics(diagnostics);
        if (typeof window !== 'undefined' && import.meta.env.DEV) {
          (window as any).__watershedPhysicsWorker = {
            simLinked: proxy.isSimLinked,
            waterForce: diagnostics,
            tickOrder: [
              'take-sim-hull-force (or the main thread\'s TS mirror force)',
              'apply-impulses',
              'rapier-step',
              'post-hull-to-sim',
              'post-snapshot',
            ],
          };
        }
      }
    }).catch((error) => {
      // A step in flight when the session stops rejects with "disposed".
      if (workerProxyRef.current === proxy) console.warn('[RaftVehicle] Rapier worker step failed', error);
    }).finally(() => {
      workerStepPendingRef.current = false;
    });
  };

  useEffect(() => {
    let workerSession: RaftWorkerSession<RapierWorkerProxy> | null = null;
    if (bodyRef.current) {
      raftVehicle.current.initialize(bodyRef.current, new THREE.Vector3(...PLAYER_SPAWN.position));
      raftVehicle.current.setSurfaceMaterial(SurfaceMaterial.WATER);
      // The main-thread body owns the raft until the worker session is ready:
      // the worker world is the streamed level, so it waits for the track (#465 C2).
      bodyRef.current.applyImpulse({ x: 0, y: 2, z: 0 }, true);
      if (useWorkerPhysics) {
        workerSession = startRaftWorkerSession({
          createProxy: createRapierWorkerProxy,
          raft: {
            halfExtents: [WATER_PHYSICS.RAFT_WIDTH * 0.5, WATER_PHYSICS.RAFT_HEIGHT * 0.5, WATER_PHYSICS.RAFT_LENGTH * 0.5],
            mass: WATER_PHYSICS.RAFT_MASS,
            linearDamping: 2,
            angularDamping: 2.5,
          },
          getRaftPosition: () => {
            const t = bodyRef.current?.translation?.();
            return t ? [t.x, t.y, t.z] : [...PLAYER_SPAWN.position];
          },
          linkSim: linkPhysicsToSim,
          onReady: (proxy, workerState) => {
            workerProxyRef.current = proxy;
            workerReadyRef.current = true;
            setPhysicsWorkerActive(true);
            syncBodyFromWorkerState(bodyRef.current, workerState);
          },
          onFallback: (error) => {
            console.warn('[RaftVehicle] Rapier worker init failed; using main-thread physics', error);
            workerReadyRef.current = false;
            setPhysicsWorkerActive(false);
          },
        });
      }
      tippingState.current.lastSafePosition.copy(bodyRef.current.translation());
    }

    const handleBiomeChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const biome = customEvent.detail?.biome || 'canyonSummer';
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
      if (workerSession) {
        workerSession.stop();
        if (workerProxyRef.current === workerSession.proxy) workerProxyRef.current = null;
      }
      workerReadyRef.current = false;
      workerStepPendingRef.current = false;
      setPhysicsWorkerActive(false);
      setPhysicsWorkerDiagnostics(null);
    };
  }, [useWorkerPhysics]);

  useRaftControls({
    bodyRef,
    raftVehicle,
    camera,
    controls,
    workerProxyRef,
    workerReadyRef,
    useWorkerPhysics,
    stepWorkerProxy,
    buoyancyState,
    tippingState,
    paddleState,
    staminaState,
    stunState,
    forwardBiasState,
    foamParticles,
    shedParticles,
    collisionState,
    raftMaterialRef,
    shelfLaunchFiredRef,
    shelfTriggerRef,
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
        userData={{ isPlayer: true }}
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

      {/* Stepped and drawn in useFrame: physics spawns, nothing re-renders (#503 B). */}
      <ParticlePoolMesh pool={foamParticles} opacity={0.85} />
      <ParticlePoolMesh pool={shedParticles} opacity={0.6} />
      <ParticlePoolMesh pool={collisionState.current.particles} />
    </group>
  );
});

export default RaftVehicle;
