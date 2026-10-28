/**
 * SplashSystem — sole player/raft water-contact VFX owner.
 *
 * Entry/exit splash arcs, rate-limited cruise splash, foam trail, raft mist crown,
 * and raft bow-wave. Spawn stays in JS ParticlePool; splash and mist integrate
 * on the session's one native module (`stepSplashParticles`, #390) — in the
 * sim worker on a WebGL boot, on this thread under `?simWorker=0`, and not at
 * all on a native-WebGPU boot (nativeParticles.ts). Foam is always JS. Caps
 * from LOD.
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  ParticlePool,
  VFXParticle,
  FoamParticle,
  MistParticle,
} from '../pools/ParticlePool';
import { useBiomeSelector } from '../biome/BiomeSystem';
import { injectSWEDisturbance } from './SWEHeightField';
import { useLOD } from '../lod/LODManager';
import {
  CRUISE_COOLDOWN,
  CRUISE_MIN_SPEED,
  entryExitSplashCount,
  foamTrailCount,
  mistSpawnCount,
  raftSubmergedRatio,
  resolveSplashFrameEvents,
} from './splashSpawnMath';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createSplashBowWaveMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';
import { resolveNativeOwner } from '../../sim/nativeOwner';
import { createSplashIntegrator, type SplashIntegrator } from '../pools/nativeParticles';
import { NonEmptyInstancedMesh } from '../../rendering/instancing/NonEmptyInstancedMesh';
import { pulse } from '../../input/haptics';
import { createRng } from '../../math/random';
import { simCore } from '../../sim/core/SimCore';
import { WATER_LEVEL } from '../../constants/game';

/** Spawn origin handed to the pools (they copy it): reused, not a vector per spawn (#521 D). */
const _spawnAt = new THREE.Vector3();

/** This module's seeded stream (#503 A): draws are reproducible run to run. */
const random = createRng(0xdb562dbf);
/**
 * The foam gate draws from the run's stream (`simCore.ctx.rng`, #521 A): it
 * decides SWE disturbances (gameplay), so its draws must not depend on how many
 * visual particles the LOD density spawned from `random` — adaptive LOD follows
 * frame time, i.e. wall time. The stream is reseeded on every run reset, so a
 * restart disturbs the field exactly as the first run did (this module's own
 * stream used to run on across restarts).
 */
const foamRandom = simCore.ctx.rng;

interface SplashSystemProps {
  playerRef: React.RefObject<any>;
  waterLevel?: number;
  waterWidth?: number;
  flowDirection?: THREE.Vector3;
  /** Surface-flow override for the VFX; unset = the biome palette's (visual) flowSpeed. */
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
    () => createSplashBowWaveMaterial(resolveMaterialBackend().backend),
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
  waterLevel = WATER_LEVEL,
  waterWidth = 12,
  flowDirection = new THREE.Vector3(0, 0, -1),
  flowSpeed: flowSpeedProp,
  isRaft = false,
  maxVelocity = 15,
}) => {
  // Visual only: the palette's foam colour and surface flow (cruise-splash
  // counts, bow wave, mist). The SWE disturbances never read either.
  const foamColor = useBiomeSelector((s) => s.currentBiome.foamColor);
  const paletteFlowSpeed = useBiomeSelector((s) => s.currentBiome.flowSpeed);
  const flowSpeed = flowSpeedProp ?? paletteFlowSpeed;
  const { config: lodConfig } = useLOD();
  const particleDensity = lodConfig.particleDensity;
  const maxInstances = lodConfig.maxParticles;

  const splashPoolRef = useRef<ParticlePool<VFXParticle> | null>(null);
  const foamPoolRef = useRef<ParticlePool<FoamParticle> | null>(null);
  const mistPoolRef = useRef<ParticlePool<MistParticle> | null>(null);
  const splashNativeRef = useRef<SplashIntegrator | null>(null);
  const mistNativeRef = useRef<SplashIntegrator | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    void resolveNativeOwner().then((owner) => {
      if (cancelled) return;
      // Null on a session without a module: the JS ParticlePool integrate (#390).
      splashNativeRef.current = createSplashIntegrator(owner, maxInstances);
      mistNativeRef.current = createSplashIntegrator(owner, MAX_MIST_INSTANCES);
    });
    return () => {
      cancelled = true;
      splashNativeRef.current?.dispose();
      mistNativeRef.current?.dispose();
      splashNativeRef.current = null;
      mistNativeRef.current = null;
    };
  }, [maxInstances]);

  const geometry = useMemo(() => new THREE.BoxGeometry(0.15, 0.15, 0.15), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: foamColor,
        transparent: true,
        opacity: 0.9,
      }),
    [foamColor],
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
        const speed = 2 + random() * 3;
        const upward = 3 + random() * 2;
        p.velocity.set(Math.cos(angle) * speed, upward, Math.sin(angle) * speed);
        p.maxLife = 0.5 + random() * 0.5;
        p.life = 0;
        p.scale = 0.3 + random() * 0.4;
        p.color.set(foamColor);
        p.rotationSpeed = (random() - 0.5) * 10;
      });
    },
    [foamColor, particleDensity],
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
        const angle = random() * Math.PI * 2;
        const radius = 0.3 + random() * 0.5;
        p.position.set(
          position.x + Math.cos(angle) * radius,
          waterLevel + 0.1,
          position.z + Math.sin(angle) * radius,
        );
        p.velocity.set(
          Math.cos(angle) * (1 + speed * 0.2) + velocity.x * 0.1,
          1.5 + random() * 2 + speed * 0.15,
          Math.sin(angle) * (1 + speed * 0.2) + velocity.z * 0.1,
        );
        p.maxLife = 0.4 + random() * 0.4;
        p.life = 0;
        p.scale = 0.1 + random() * 0.2 + speed * 0.02;
        p.color.set(foamColor);
        p.rotationSpeed = (random() - 0.5) * 8;
      });
    },
    [foamColor, waterLevel],
  );

  const spawnFoam = useCallback(
    (position: THREE.Vector3) => {
      if (!foamPoolRef.current) return;
      const count = foamTrailCount(particleDensity);
      const particles = foamPoolRef.current.acquireMultiple(count);

      particles.forEach((p) => {
        p.position.copy(position);
        p.position.x += (random() - 0.5) * 2;
        p.position.z += (random() - 0.5) * 2;
        p.driftSpeed = 0.5 + random() * 0.5;
        p.maxLife = 2 + random() * 2;
        p.life = 0;
        p.scale = 0.5 + random() * 0.5;
        p.color.set(foamColor);
      });
    },
    [foamColor, particleDensity],
  );

  const spawnMist = useCallback(
    (position: THREE.Vector3, count: number) => {
      if (!mistPoolRef.current || count <= 0) return;
      const particles = mistPoolRef.current.acquireMultiple(count);

      particles.forEach((p) => {
        p.position.set(
          position.x + (random() - 0.5) * 2,
          position.y + 0.3,
          position.z + (random() - 0.5) * 3,
        );
        p.velocity.set(
          (random() - 0.5) * 0.5,
          0.5 + random() * 0.5,
          (random() - 0.5) * 0.5,
        );
        p.maxLife = 0.8 + random() * 0.6;
        p.life = 0;
        p.scale = 0.5 + random() * 0.5;
        p.rotation = random() * Math.PI;
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

      const mat = mesh.material as THREE.Material;
      const u = materialUniformBag(mat);
      if (u?.time) u.time.value = timeRef.current;
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
      const entryPos = _spawnAt.set(playerPos.x, waterLevel, playerPos.z);
      spawnSplashArc(entryPos, 1.0);
      injectSWEDisturbance(playerPos.x, playerPos.z, 2.2, 0.55);
      pulse('impact', 0.45); // gamepad: a splash entry is a soft thump
    } else if (events.exitSplash) {
      const exitPos = _spawnAt.set(playerPos.x, waterLevel, playerPos.z);
      spawnSplashArc(exitPos, 0.5);
      injectSWEDisturbance(playerPos.x, playerPos.z, 1.4, 0.28);
    }

    if (events.cruiseCount > 0) {
      spawnCruiseSplash(
        _spawnAt.set(playerPos.x, waterLevel, playerPos.z),
        vel,
        speed,
        events.cruiseCount,
      );
      cruiseCooldownRef.current = CRUISE_COOLDOWN;
    }

    if (events.foamEligible) {
      // Two draws every eligible frame, whatever happens, so the stream stays aligned.
      const foamRoll = foamRandom();
      const disturbRoll = foamRandom();
      if (foamRoll < 0.1 * speed) {
        spawnFoam(_spawnAt.set(playerPos.x, waterLevel, playerPos.z));
        if (disturbRoll < 0.15) {
          injectSWEDisturbance(playerPos.x, playerPos.z, 0.9, 0.08);
        }
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
          _spawnAt.set(playerPos.x, playerPos.y, playerPos.z),
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

    // Update splash particles (copy active list — release mutates the pool array).
    // Spawn remains TS; native only integrates (#390), overflow past its cap in JS.
    const splashPool = splashPoolRef.current;
    const releaseSplash = (p: VFXParticle) => splashPool.release(p);
    const splashParticles = [...splashPool.getActive()];
    const splashNative = splashNativeRef.current;
    if (splashNative && splashParticles.length > 0) {
      splashNative.integrate(splashParticles, delta, -9.8, 0.98, (p) => p.update(delta, -9.8), releaseSplash);
    } else {
      splashParticles.forEach((p) => {
        if (!p.update(delta, -9.8)) releaseSplash(p);
      });
    }

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
      const mistPool = mistPoolRef.current;
      const releaseMist = (p: VFXParticle) => mistPool.release(p as MistParticle);
      const mistToUpdate = [...mistPool.getActive()];
      const mistNative = mistNativeRef.current;
      if (mistNative && mistToUpdate.length > 0) {
        mistNative.integrate(mistToUpdate, delta, 0, 1, (p) => p.update(delta), releaseMist);
      } else {
        mistToUpdate.forEach((p) => {
          if (!p.update(delta)) releaseMist(p);
        });
      }

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
      <NonEmptyInstancedMesh
        key={`splash-${maxInstances}`}
        ref={instancedMeshRef}
        args={[geometry, material, maxInstances]}
        frustumCulled={false}
      />
      {isRaft && (
        <>
          <NonEmptyInstancedMesh
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
