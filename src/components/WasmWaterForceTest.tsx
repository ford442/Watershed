import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { WATER_LEVEL } from '../constants/game';
import {
  calculateWaterForceFallback,
  getWasm,
  type NativeWaterForceConfig,
  type NativeWaterForceResult,
  type WatershedNativeModule,
} from '../systems/WatershedWasm';

const TEST_CONFIG: NativeWaterForceConfig = {
  flowSpeed: 5.2,
  waterLevel: WATER_LEVEL,
  raftMass: 150,
  raftVolume: 1.2,
  dragCoefficient: 0.47,
  frontalArea: 1.05,
  sideArea: 0.7,
  timeSeconds: 0,
  turbulenceStrength: 0.1,
  turbulenceFrequency: 2.4,
};

const WasmWaterForceTest = forwardRef<any>((_props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const wasmRef = useRef<WatershedNativeModule | null>(null);
  const statusRef = useRef<'loading' | 'ready' | 'fallback'>('loading');
  const lastForceRef = useRef<NativeWaterForceResult | null>(null);
  const loggedRef = useRef(false);
  const { camera } = useThree();

  useImperativeHandle(forwardedRef, () => bodyRef.current);

  useEffect(() => {
    let cancelled = false;
    getWasm()
      .then((wasm) => {
        if (cancelled) return;
        wasmRef.current = wasm;
        statusRef.current = 'ready';
      })
      .catch((error) => {
        if (cancelled) return;
        statusRef.current = 'fallback';
        console.warn('[WasmWaterForceTest] using TypeScript fallback', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useFrame((state, delta) => {
    const body = bodyRef.current;
    if (!body) return;

    const pos = body.translation();
    const vel = body.linvel();
    const config = {
      ...TEST_CONFIG,
      timeSeconds: state.clock.elapsedTime,
    };

    const force = wasmRef.current
      ? wasmRef.current.calculateWaterForce(
          pos.x, pos.y, pos.z,
          vel.x, vel.y, vel.z,
          0, -1,
          config.flowSpeed,
          config.waterLevel,
          config.raftMass,
          config.raftVolume,
          config.dragCoefficient,
          config.frontalArea,
          config.sideArea,
          config.timeSeconds,
          config.turbulenceStrength,
          config.turbulenceFrequency,
        )
      : calculateWaterForceFallback(
          {
            position: pos,
            velocity: vel,
            flowDirection: { x: 0, z: -1 },
          },
          config,
        );

    lastForceRef.current = force;
    body.applyImpulse({
      x: force.forceX * delta * 0.001,
      y: force.forceY * delta * 0.001,
      z: force.forceZ * delta * 0.001,
    }, true);

    camera.position.lerp(new THREE.Vector3(pos.x + 4, pos.y + 4, pos.z + 8), 0.06);
    camera.lookAt(pos.x, pos.y, pos.z - 4);

    if (typeof window !== 'undefined') {
      (window as any).__watershedWasmWaterTest = {
        status: statusRef.current,
        position: { x: pos.x, y: pos.y, z: pos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
        force,
      };
    }

    if (!loggedRef.current && statusRef.current === 'ready') {
      loggedRef.current = true;
      console.info('[WasmWaterForceTest] native force is moving test raft', {
        force,
        position: pos,
      });
    }
  });

  return (
    <group>
      <mesh position={[0, WATER_LEVEL - 0.04, -10]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[18, 80, 1, 1]} />
        <meshStandardMaterial color="#1b83a6" roughness={0.28} metalness={0.05} transparent opacity={0.72} />
      </mesh>

      <RigidBody type="fixed" position={[-4.8, WATER_LEVEL + 0.6, -18]}>
        <CuboidCollider args={[0.25, 1.2, 34]} />
        <mesh receiveShadow>
          <boxGeometry args={[0.5, 2.4, 68]} />
          <meshStandardMaterial color="#8b5a3c" roughness={0.85} />
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" position={[4.8, WATER_LEVEL + 0.6, -18]}>
        <CuboidCollider args={[0.25, 1.2, 34]} />
        <mesh receiveShadow>
          <boxGeometry args={[0.5, 2.4, 68]} />
          <meshStandardMaterial color="#8b5a3c" roughness={0.85} />
        </mesh>
      </RigidBody>

      <RigidBody type="fixed" position={[1.8, WATER_LEVEL + 0.15, -18]}>
        <CuboidCollider args={[0.9, 0.45, 0.9]} />
        <mesh castShadow receiveShadow>
          <dodecahedronGeometry args={[1.1, 0]} />
          <meshStandardMaterial color="#5f6468" roughness={0.92} />
        </mesh>
      </RigidBody>

      <RigidBody
        ref={bodyRef}
        type="dynamic"
        mass={TEST_CONFIG.raftMass}
        linearDamping={0.35}
        angularDamping={2.2}
        position={[0, WATER_LEVEL + 0.05, -2]}
      >
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.0, 0.35, 3.0]} />
          <meshStandardMaterial color="#7a4a2a" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <boxGeometry args={[1.55, 0.08, 2.35]} />
          <meshStandardMaterial color="#4a2c18" roughness={0.8} />
        </mesh>
      </RigidBody>
    </group>
  );
});

export default WasmWaterForceTest;
