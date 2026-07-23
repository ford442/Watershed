/**
 * SplashSystem — sole player/raft water-contact VFX owner.
 *
 * Entry/exit splash arcs, rate-limited cruise splash, foam trail, raft mist crown,
 * and raft bow-wave. All particle draws go through ParticlePool; SWE disturbances
 * inject only on this path. Caps scale from useLOD().config.
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  ParticlePool,
  VFXParticle,
  FoamParticle,
  MistParticle,
} from './ParticlePool';
import { useBiomeMaterials } from './BiomeSystem';
import { injectSWEDisturbance } from './SWEHeightField';
import { useLOD } from './LODManager';
import {
  CRUISE_COOLDOWN,
  CRUISE_MIN_SPEED,
  entryExitSplashCount,
  foamTrailCount,
  mistSpawnCount,
  raftSubmergedRatio,
  resolveSplashFrameEvents,
} from './splashSpawnMath';

interface SplashSystemProps {
  playerRef: React.RefObject<any>;
  waterLevel?: number;
  waterWidth?: number;
  flowDirection?: THREE.Vector3;
  flowSpeed?: number;
  isRaft?: boolean;
  maxVelocity?: number;
}

const createSplashParticle = (): VFXParticle => new VFXParticle();
const createFoamParticle = (): FoamParticle => new FoamParticle();
const createMistParticle = (): MistParticle => new MistParticle();

const MAX_MIST_INSTANCES = 30;
const PROXIMITY = 1.0;

/** Raft bow-wave plane with CPU + shader deformation. */
function RaftBowWave({
  meshRef,
  waterLevel,
}: {
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
  waterLevel: number;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(3, 4, 16, 16);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -2);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          uniform float time;
          varying vec2 vUv;
          varying float vNoise;
          void main() {
            vUv = uv;
            vec3 pos = position;
            float noise = sin(pos.x * 2.0 + time * 2.0) * cos(pos.z * 1.5 + time * 1.5);
            pos.y += noise * 0.05;
            vNoise = noise;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          varying float vNoise;
          void main() {
            float alpha = 0.5 + vNoise * 0.2;
            vec3 color = vec3(0.667, 0.867, 1.0);
            gl_FragColor = vec4(color, alpha * 0.6);
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    [],
  );

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[0, waterLevel, 0]}
      visible={false}
    />
  );
}

export const SplashSystem: React.FC<SplashSystemProps> = ({
  playerRef,
  waterLevel = 0.5,
  waterWidth = 12,
  flowDirection = new THREE.Vector3(0, 0, -1),
  flowSpeed = 1.0,
  isRaft = false,
  maxVelocity = 15,
}) => {
  const { water } = useBiomeMaterials();
  const { config: lodConfig } = useLOD();
  const particleDensity = lodConfig.particleDensity;
  const maxInstances = lodConfig.maxParticles;

  const splashPoolRef = useRef<ParticlePool<VFXParticle> | null>(null);
  const foamPoolRef = useRef<ParticlePool<FoamParticle> | null>(null);
  const mistPoolRef = useRef<ParticlePool<MistParticle> | null>(null);

  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const mistMeshRef = useRef<THREE.InstancedMesh>(null);
  const bowWaveMeshRef = useRef<THREE.Mesh | null>(null);
  const dummy = useRef(new THREE.Object3D());
  const timeRef = useRef(0);
  const wasInWaterRef = useRef(false);
  const cruiseCooldownRef = useRef(0);
  const forwardScratch = useRef(new THREE.Vector3());
  const quatScratch = useRef(new THREE.Quaternion());

  useEffect(() => {
    splashPoolRef.current = new ParticlePool(createSplashParticle, 300, 1000);
    foamPoolRef.current = new ParticlePool(createFoamParticle, 200, 800);
    mistPoolRef.current = new ParticlePool(createMistParticle, 30, MAX_MIST_INSTANCES);
    return () => {
      splashPoolRef.current?.dispose();
      foamPoolRef.current?.dispose();
      mistPoolRef.current?.dispose();
    };
  }, []);

  const geometry = useMemo(() => new THREE.BoxGeometry(0.15, 0.15, 0.15), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: water.foamColor,
        transparent: true,
        opacity: 0.9,
      }),
    [water.foamColor],
  );

  const mistGeometry = useMemo(() => new THREE.PlaneGeometry(0.3, 0.3), []);
  const mistMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  const spawnSplashArc = useCallback(
    (position: THREE.Vector3, intensity: number) => {
      if (!splashPoolRef.current) return;
      const count = entryExitSplashCount(intensity, particleDensity);
      const particles = splashPoolRef.current.acquireMultiple(count);

      particles.forEach((p, i) => {
        p.position.copy(position);
        const angle = (i / count) * Math.PI * 2;
        const speed = 2 + Math.random() * 3;
        const upward = 3 + Math.random() * 2;
        p.velocity.set(Math.cos(angle) * speed, upward, Math.sin(angle) * speed);
        p.maxLife = 0.5 + Math.random() * 0.5;
        p.life = 0;
        p.scale = 0.3 + Math.random() * 0.4;
        p.color.set(water.foamColor);
        p.rotationSpeed = (Math.random() - 0.5) * 10;
      });
    },
    [water.foamColor, particleDensity],
  );

  const spawnCruiseSplash = useCallback(
    (
      position: THREE.Vector3,
      velocity: { x: number; z: number },
      speed: number,
      count: number,
    ) => {
      if (!splashPoolRef.current || count <= 0) return;
      const particles = splashPoolRef.current.acquireMultiple(count);

      particles.forEach((p) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.3 + Math.random() * 0.5;
        p.position.set(
          position.x + Math.cos(angle) * radius,
          waterLevel + 0.1,
          position.z + Math.sin(angle) * radius,
        );
        p.velocity.set(
          Math.cos(angle) * (1 + speed * 0.2) + velocity.x * 0.1,
          1.5 + Math.random() * 2 + speed * 0.15,
          Math.sin(angle) * (1 + speed * 0.2) + velocity.z * 0.1,
        );
        p.maxLife = 0.4 + Math.random() * 0.4;
        p.life = 0;
        p.scale = 0.1 + Math.random() * 0.2 + speed * 0.02;
        p.color.set(water.foamColor);
        p.rotationSpeed = (Math.random() - 0.5) * 8;
      });
    },
    [water.foamColor, waterLevel],
  );

  const spawnFoam = useCallback(
    (position: THREE.Vector3) => {
      if (!foamPoolRef.current) return;
      const count = foamTrailCount(particleDensity);
      const particles = foamPoolRef.current.acquireMultiple(count);

      particles.forEach((p) => {
        p.position.copy(position);
        p.position.x += (Math.random() - 0.5) * 2;
        p.position.z += (Math.random() - 0.5) * 2;
        p.driftSpeed = 0.5 + Math.random() * 0.5;
        p.maxLife = 2 + Math.random() * 2;
        p.life = 0;
        p.scale = 0.5 + Math.random() * 0.5;
        p.color.set(water.foamColor);
      });
    },
    [water.foamColor, particleDensity],
  );

  const spawnMist = useCallback(
    (position: THREE.Vector3, count: number) => {
      if (!mistPoolRef.current || count <= 0) return;
      const particles = mistPoolRef.current.acquireMultiple(count);

      particles.forEach((p) => {
        p.position.set(
          position.x + (Math.random() - 0.5) * 2,
          position.y + 0.3,
          position.z + (Math.random() - 0.5) * 3,
        );
        p.velocity.set(
          (Math.random() - 0.5) * 0.5,
          0.5 + Math.random() * 0.5,
          (Math.random() - 0.5) * 0.5,
        );
        p.maxLife = 0.8 + Math.random() * 0.6;
        p.life = 0;
        p.scale = 0.5 + Math.random() * 0.5;
        p.rotation = Math.random() * Math.PI;
        p.rotationSpeed = 0.5;
      });
    },
    [],
  );

  const updateBowWave = useCallback(
    (speed: number) => {
      const mesh = bowWaveMeshRef.current;
      if (!mesh || !isRaft) return;

      const positions = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const waveHeight = 0.1 * (speed / maxVelocity) * (0.8 + flowSpeed * 0.4);
      const frequency = speed * 0.5;
      const time = timeRef.current * 2;

      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const y =
          Math.sin(x * frequency + time) *
          waveHeight *
          Math.cos(z * frequency * 0.5 + time) *
          (1 - Math.abs(z) / 4);
        positions.setY(i, y);
      }
      positions.needsUpdate = true;
      mesh.visible = speed > CRUISE_MIN_SPEED;

      const mat = mesh.material as THREE.ShaderMaterial;
      if (mat.uniforms?.time) {
        mat.uniforms.time.value = timeRef.current;
      }
    },
    [isRaft, maxVelocity, flowSpeed],
  );

  useFrame((_state, delta) => {
    if (!splashPoolRef.current || !foamPoolRef.current) return;
    if (!playerRef.current) return;

    timeRef.current += delta;
    cruiseCooldownRef.current = Math.max(0, cruiseCooldownRef.current - delta);

    const body = playerRef.current;
    const playerPos = body.translation ? body.translation() : body.position;
    if (!playerPos) return;

    const vel = body.linvel
      ? body.linvel()
      : { x: 0, y: 0, z: 0 };
    const speed = Math.sqrt(vel.x ** 2 + vel.z ** 2);

    const isInWater =
      playerPos.y < waterLevel && Math.abs(playerPos.x) < waterWidth / 2;
    const distFromWater = Math.abs(playerPos.y - waterLevel);
    const isNearWater = distFromWater < PROXIMITY;

    const events = resolveSplashFrameEvents(
      wasInWaterRef.current,
      isInWater,
      isNearWater,
      speed,
      maxVelocity,
      flowSpeed,
      particleDensity,
      cruiseCooldownRef.current,
    );

    if (events.entrySplash) {
      const entryPos = new THREE.Vector3(playerPos.x, waterLevel, playerPos.z);
      spawnSplashArc(entryPos, 1.0);
      injectSWEDisturbance(playerPos.x, playerPos.z, 2.2, 0.55);
    } else if (events.exitSplash) {
      const exitPos = new THREE.Vector3(playerPos.x, waterLevel, playerPos.z);
      spawnSplashArc(exitPos, 0.5);
      injectSWEDisturbance(playerPos.x, playerPos.z, 1.4, 0.28);
    }

    if (events.cruiseCount > 0) {
      spawnCruiseSplash(
        new THREE.Vector3(playerPos.x, waterLevel, playerPos.z),
        vel,
        speed,
        events.cruiseCount,
      );
      cruiseCooldownRef.current = CRUISE_COOLDOWN;
    }

    if (events.foamEligible && Math.random() < 0.1 * speed) {
      spawnFoam(new THREE.Vector3(playerPos.x, waterLevel, playerPos.z));
      if (Math.random() < 0.15) {
        injectSWEDisturbance(playerPos.x, playerPos.z, 0.9, 0.08);
      }
    }

    if (isRaft) {
      const submerged = raftSubmergedRatio(playerPos.y, waterLevel);
      const mistCount = mistSpawnCount(
        true,
        submerged,
        speed,
        flowSpeed,
        particleDensity,
      );
      if (mistCount > 0) {
        spawnMist(
          new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z),
          mistCount,
        );
      }

      updateBowWave(speed);

      if (bowWaveMeshRef.current && body.rotation) {
        const rot = body.rotation();
        quatScratch.current.set(rot.x, rot.y, rot.z, rot.w);
        forwardScratch.current.set(0, 0, -1).applyQuaternion(quatScratch.current);
        bowWaveMeshRef.current.position.set(
          playerPos.x + forwardScratch.current.x * 1.5,
          waterLevel,
          playerPos.z + forwardScratch.current.z * 1.5,
        );
        bowWaveMeshRef.current.rotation.y = Math.atan2(
          forwardScratch.current.x,
          forwardScratch.current.z,
        );
      }
    }

    wasInWaterRef.current = isInWater;

    // Update splash particles (copy active list — release mutates the pool array)
    const splashParticles = [...splashPoolRef.current.getActive()];
    splashParticles.forEach((p) => {
      if (!p.update(delta, -9.8)) {
        splashPoolRef.current!.release(p);
      }
    });

    // Update foam particles
    const foamParticles = [...foamPoolRef.current.getActive()];
    foamParticles.forEach((p) => {
      if (!p.update(delta, flowDirection, flowSpeed)) {
        foamPoolRef.current!.release(p);
      }
    });

    // Write splash + foam to shared instanced mesh
    if (instancedMeshRef.current) {
      const allParticles = [
        ...splashPoolRef.current.getActive(),
        ...foamPoolRef.current.getActive(),
      ];
      const renderCount = Math.min(allParticles.length, maxInstances);

      for (let i = 0; i < renderCount; i++) {
        const p = allParticles[i];
        const lifeRatio = p.getLifeRatio();
        const age = 1 - lifeRatio;
        let currentScale = p.scale;
        if (age < 0.1) currentScale *= age / 0.1;
        else currentScale *= lifeRatio;

        dummy.current.position.copy(p.position);
        dummy.current.scale.setScalar(Math.max(0, currentScale));
        dummy.current.rotation.set(0, p.rotation, 0);
        dummy.current.updateMatrix();
        instancedMeshRef.current.setMatrixAt(i, dummy.current.matrix);
      }

      for (let i = renderCount; i < maxInstances; i++) {
        dummy.current.scale.setScalar(0);
        dummy.current.updateMatrix();
        instancedMeshRef.current.setMatrixAt(i, dummy.current.matrix);
      }

      instancedMeshRef.current.count = renderCount;
      instancedMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    // Mist instances (raft)
    if (isRaft && mistMeshRef.current && mistPoolRef.current) {
      const mistToUpdate = [...mistPoolRef.current.getActive()];
      mistToUpdate.forEach((p) => {
        if (!p.update(delta)) {
          mistPoolRef.current!.release(p);
        }
      });

      const activeMist = mistPoolRef.current.getActive();
      const mistRender = Math.min(activeMist.length, MAX_MIST_INSTANCES);

      for (let i = 0; i < mistRender; i++) {
        const p = activeMist[i];
        // Scale-fade replaces unused per-instance alpha
        const fade = p.getLifeRatio();
        dummy.current.position.copy(p.position);
        dummy.current.scale.setScalar(p.scale * (0.5 + fade * 0.5));
        dummy.current.rotation.set(0, 0, p.rotation);
        dummy.current.updateMatrix();
        mistMeshRef.current.setMatrixAt(i, dummy.current.matrix);
      }
      for (let i = mistRender; i < MAX_MIST_INSTANCES; i++) {
        dummy.current.scale.setScalar(0);
        dummy.current.updateMatrix();
        mistMeshRef.current.setMatrixAt(i, dummy.current.matrix);
      }
      mistMeshRef.current.count = mistRender;
      mistMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh
        key={`splash-${maxInstances}`}
        ref={instancedMeshRef}
        args={[geometry, material, maxInstances]}
        frustumCulled={false}
      />
      {isRaft && (
        <>
          <instancedMesh
            ref={mistMeshRef}
            args={[mistGeometry, mistMaterial, MAX_MIST_INSTANCES]}
            frustumCulled={false}
          />
          <RaftBowWave meshRef={bowWaveMeshRef} waterLevel={waterLevel} />
        </>
      )}
    </group>
  );
};

export default SplashSystem;
