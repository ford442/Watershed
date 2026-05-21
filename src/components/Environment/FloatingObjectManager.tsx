import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { InstancedRigidBodies } from '@react-three/rapier';
import {
  calculateBuoyancyForce,
  calculateDragForce,
  calculateFlowForce,
} from '../../physics/WaterForces';
import {
  registerFloatingPlatform,
  unregisterFloatingPlatform,
} from '../../systems/FloatingObjectRegistry';
import { WATER_LEVEL } from '../../constants/game';
import { FLOATING_OBJECT } from '../../constants/game';

// =============================================================================
// TYPES
// =============================================================================

export type FloatingObjectType = 'log' | 'tire' | 'boat' | 'debris';

export interface FloatingObjectConfig {
  type: FloatingObjectType;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

// =============================================================================
// GEOMETRY & MATERIAL
// =============================================================================

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({
  color: '#8B7355',
  roughness: 0.8,
  metalness: 0.1,
});

// =============================================================================
// FORCE CONFIG
// =============================================================================

const FORCE_CONFIG = {
  flowSpeed: 2.0,
  maxForce: 8,
  turbulence: 0.2,
  turbulenceFreq: 1.5,
};

// =============================================================================
// COMPONENT
// =============================================================================

interface FloatingObjectManagerProps {
  /** The CatmullRomCurve3 for this segment */
  path: THREE.CatmullRomCurve3 | null;
  /** Width of the water channel */
  waterWidth?: number;
  /** Flow speed multiplier */
  flowSpeed?: number;
  /** Water level Y */
  waterLevel?: number;
  /** Max objects to spawn */
  count?: number;
  /** Segment ID for deterministic seeding */
  segmentId?: number;
}

export default function FloatingObjectManager({
  path,
  waterWidth = 12,
  flowSpeed = 1.0,
  waterLevel = WATER_LEVEL,
  count = 6,
  segmentId = 0,
}: FloatingObjectManagerProps) {
  const bodiesRef = useRef<(any | null)[]>([]);
  const timeRef = useRef(0);

  // Generate object instances deterministically
  const instances = useMemo(() => {
    if (!path) return [];

    const items: Array<{
      key: string;
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
      type: FloatingObjectType;
    }> = [];

    const seededRandom = (s: number) => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };

    let seed = segmentId * 7919;
    const pathLen = path.getLength();

    for (let i = 0; i < count; i++) {
      const t = seededRandom(seed++);
      const point = path.getPointAt(t);
      const tangent = path.getTangentAt(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

      // Place in water channel, not on banks
      const lateralRange = waterWidth * 0.35;
      const lateralOffset = (seededRandom(seed++) - 0.5) * 2 * lateralRange;

      const position = point
        .clone()
        .add(binormal.multiplyScalar(lateralOffset));
      position.y = waterLevel - 0.2;

      // Randomize type
      const typeRoll = seededRandom(seed++);
      let type: FloatingObjectType;
      let scale: [number, number, number];

      if (typeRoll < 0.35) {
        type = 'log';
        scale = [0.35, 0.35, 1.8 + seededRandom(seed++) * 0.4];
      } else if (typeRoll < 0.55) {
        type = 'tire';
        scale = [0.7 + seededRandom(seed++) * 0.2, 0.25, 0.7 + seededRandom(seed++) * 0.2];
      } else if (typeRoll < 0.75) {
        type = 'boat';
        scale = [0.9 + seededRandom(seed++) * 0.3, 0.35, 1.4 + seededRandom(seed++) * 0.4];
      } else {
        type = 'debris';
        const s = 0.25 + seededRandom(seed++) * 0.35;
        scale = [s, s, s];
      }

      const rotation: [number, number, number] = [
        (seededRandom(seed++) - 0.5) * 0.3,
        seededRandom(seed++) * Math.PI * 2,
        (seededRandom(seed++) - 0.5) * 0.3,
      ];

      items.push({
        key: `float-${segmentId}-${i}`,
        position: [position.x, position.y, position.z],
        rotation,
        scale,
        type,
      });
    }

    return items;
  }, [path, waterWidth, waterLevel, count, segmentId]);

  // Lazy registration: store handle → api mapping to avoid world.getRigidBody()
  // in the physics loop. Calling getRigidBody() across multiple concurrent
  // FloatingObjectManager instances (one per segment) creates simultaneous Rapier
  // WASM borrows that trigger "recursive use of object" panics. Using the @react-three/rapier
  // api objects directly is safe because they are internally synchronized.
  const registeredHandlesRef = useRef<Set<number>>(new Set());
  const handleToApiRef = useRef<Map<number, any>>(new Map());

  useEffect(() => {
    return () => {
      registeredHandlesRef.current.forEach((handle) => {
        unregisterFloatingPlatform(handle);
      });
      registeredHandlesRef.current.clear();
      handleToApiRef.current.clear();
    };
  }, [instances]);

  useFrame(() => {
    // Discover newly-available handles via plain index access — calling
    // bodiesRef.current.forEach internally invokes world.forEachRigidBody,
    // which borrows the Rapier RigidBodySet and races with translation()
    // calls from sibling FOM instances ("recursive use of an object" panic).
    const arr = bodiesRef.current;
    for (let i = 0; i < instances.length; i += 1) {
      const api = arr[i];
      if (api && api.handle !== undefined && !registeredHandlesRef.current.has(api.handle)) {
        registerFloatingPlatform(api.handle);
        registeredHandlesRef.current.add(api.handle);
        handleToApiRef.current.set(api.handle, api);
      }
    }
  });

  // Per-frame physics: buoyancy, drag, flow force
  // PHYSICS_SCALE: body mass = density * volume * 0.001 (gameplay scaling).
  // Forces computed in real SI units (N) must be scaled by the same factor so
  // impulse = force * dt stays proportional to the scaled mass. Without this,
  // a 4903 N buoyancy impulse on a 0.3 kg body would accelerate it ~260 m/s
  // per frame, causing Rapier's numerical solver to panic with "unreachable".
  const PHYSICS_SCALE = 0.001;
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    timeRef.current += dt;

    if (!path) return;

    let i = 0;
    for (const [, api] of handleToApiRef.current) {
      i += 1;
      try {
        const pos = api.translation();
        const vel = api.linvel();
        if (!pos || !vel) continue;

        // === BUOYANCY ===
        const submergedDepth = waterLevel - pos.y;
        const submergedRatio = THREE.MathUtils.clamp(submergedDepth / 0.5, 0, 1);
        if (submergedRatio > 0) {
          const buoyancy = calculateBuoyancyForce(
            submergedRatio,
            FLOATING_OBJECT.DEBRIS_VOLUME,
            1000,
            9.80665
          );
          api.applyImpulse({ x: 0, y: buoyancy * dt * PHYSICS_SCALE, z: 0 }, true);
        }

        // === DRAG ===
        const velocity = new THREE.Vector3(vel.x, vel.y, vel.z);
        const dragForce = calculateDragForce(
          velocity,
          FLOATING_OBJECT.DRAG_COEFFICIENT,
          FLOATING_OBJECT.DRAG_AREA,
          1000
        );
        api.applyImpulse(
          { x: dragForce.x * dt * PHYSICS_SCALE, y: dragForce.y * dt * PHYSICS_SCALE, z: dragForce.z * dt * PHYSICS_SCALE },
          true
        );

        // === FLOW FORCE ===
        const position = new THREE.Vector3(pos.x, pos.y, pos.z);
        const flowForce = calculateFlowForce(
          position,
          null,
          {
            flowSpeed: FORCE_CONFIG.flowSpeed * flowSpeed * FLOATING_OBJECT.FLOW_INFLUENCE,
            maxForce: FORCE_CONFIG.maxForce,
            turbulence: FORCE_CONFIG.turbulence,
            turbulenceFreq: FORCE_CONFIG.turbulenceFreq,
          },
          timeRef.current
        );
        // Flow force uses empirical scale (0.01) so objects drift visibly downstream
        // while remaining physically stable with the 0.001-scaled mass.
        const FLOW_SCALE = 0.01;
        api.applyImpulse(
          { x: flowForce.x * dt * FLOW_SCALE, y: flowForce.y * dt * FLOW_SCALE, z: flowForce.z * dt * FLOW_SCALE },
          true
        );

        // === CENTERING FORCE ===
        const tNearest = Math.max(0, Math.min(1, i / instances.length));
        const pathPoint = path.getPointAt(tNearest);
        const toCenter = new THREE.Vector3(pathPoint.x - pos.x, 0, pathPoint.z - pos.z);
        const distFromCenter = Math.sqrt(toCenter.x * toCenter.x + toCenter.z * toCenter.z);
        if (distFromCenter > waterWidth * 0.4) {
          toCenter.normalize().multiplyScalar(2.0 * dt);
          api.applyImpulse({ x: toCenter.x, y: 0, z: toCenter.z }, true);
        }
      } catch {
        // skip this body this frame
      }
    }
  });

  if (!path || instances.length === 0) return null;

  return (
    <InstancedRigidBodies
      ref={bodiesRef}
      instances={instances}
      type="dynamic"
      colliders="cuboid"
      mass={FLOATING_OBJECT.DEBRIS_DENSITY * FLOATING_OBJECT.DEBRIS_VOLUME * 0.001} // Scale mass for gameplay
      linearDamping={0.8}
      angularDamping={0.6}
      friction={0.3}
      restitution={0.2}
      canSleep={false}
    >
      <instancedMesh
        args={[geometry, material, instances.length]}
        receiveShadow
        castShadow
      />
    </InstancedRigidBodies>
  );
}
