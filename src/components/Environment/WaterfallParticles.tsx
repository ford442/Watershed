import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useLOD } from '../../systems/lod/LODManager';
import type { WaterfallParticlesProps } from './types';
import { getWasm, heapF32, peekWasm, type WatershedNativeModule } from '../../systems/water/WatershedWasm';
import { NonEmptyInstancedMesh } from '../NonEmptyInstancedMesh';

interface WaterfallParticle {
  x: number;
  y: number;
  z: number;
  speed: number;
  scale: number;
  initialY: number;
  vx: number;
  vz: number;
  active: boolean;
}

/** JS object-pool cap when WASM SoA is missing (ABI 6 / load fail). See #390. */
const MAX_POOL_JS = 500;
/** InstancedMesh / WASM SoA cap. Segment-14 400-count uses WASM SoA when live.
 *  Ultra (`maxParticles >= 2000`) may simulate up to 1000 only on that path. */
const MAX_POOL = 1000;
const DEPTH_Z = 5;

/** Cached px/py/pz/scale heap views over one waterfall particle-SoA allocation. */
export interface WaterfallSoAViews {
  px?: Float32Array;
  py?: Float32Array;
  pz?: Float32Array;
  scale?: Float32Array;
}

/**
 * Rebind (or reuse) the four `Float32Array` views this component reads via
 * `heapF32()` (#415/#419 remainder): a grown `HEAPF32.buffer` forces a
 * rebuild, but an unchanged heap reuses the cached views instead of
 * allocating four typed arrays every frame. Callers must reset `views` to
 * `{}` whenever `base` (the SoA pointer) changes, since heapF32 only
 * detects a *grown* buffer, not a different pointer into the same one.
 */
export function bindWaterfallViews(
  mod: WatershedNativeModule,
  base: number,
  capacity: number,
  views: WaterfallSoAViews,
): Required<WaterfallSoAViews> {
  views.px = heapF32(mod, base, capacity, views.px);
  views.py = heapF32(mod, base + capacity * 4, capacity, views.py);
  views.pz = heapF32(mod, base + capacity * 8, capacity, views.pz);
  views.scale = heapF32(mod, base + 8 * capacity * 4, capacity, views.scale);
  return views as Required<WaterfallSoAViews>;
}

export default function WaterfallParticles({
  count: baseCount = 300,
  width = 15,
  height = 25,
  playerVelocity = 0,
  particleDensity = 1.0,
  fanAngle = 0,
}: WaterfallParticlesProps) {
  const fanSpreadRad = (fanAngle * Math.PI) / 180;
  const { config: lodConfig } = useLOD();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const currentCountRef = useRef(baseCount);
  const targetCountRef = useRef(baseCount);
  const fadeAlphaRef = useRef(1.0);
  const wasmRef = useRef<WatershedNativeModule | null>(null);
  const soaPtrRef = useRef(0);
  const soaViewsRef = useRef<WaterfallSoAViews>({});
  const seedRef = useRef(0xC0FFEE ^ (baseCount * 17));
  const wasmReadyRef = useRef(false);

  const wasmLive = peekWasm() !== null;

  const calculatedCount = useMemo(() => {
    const densityBase = 100 + (particleDensity * 300);
    let velocityMultiplier = 1.0;
    if (playerVelocity > 20) {
      velocityMultiplier = 1.5;
    }

    let lodMultiplier = 1.0;
    const maxParticles = lodConfig?.maxParticles ?? 500;
    if (maxParticles <= 200) {
      lodMultiplier = 0.25;
    } else if (maxParticles <= 500) {
      lodMultiplier = 0.6;
    }

    let finalCount = Math.floor(densityBase * velocityMultiplier * lodMultiplier);
    const useWasmCap = wasmLive || wasmReadyRef.current;
    const absoluteMax = maxParticles <= 200
      ? 100
      : (useWasmCap && maxParticles >= 2000 ? 1000 : MAX_POOL_JS);
    finalCount = Math.min(absoluteMax, finalCount);

    return finalCount;
  }, [baseCount, particleDensity, playerVelocity, lodConfig, wasmLive]);

  useEffect(() => {
    targetCountRef.current = calculatedCount;
  }, [calculatedCount]);

  useEffect(() => {
    let cancelled = false;
    void getWasm()
      .then((mod) => {
        if (cancelled) return;
        const ptr = mod.allocateParticleSoA(MAX_POOL);
        seedRef.current = mod.initWaterfallParticles(
          ptr, MAX_POOL, MAX_POOL, width, height, DEPTH_Z, fanSpreadRad, seedRef.current,
        );
        wasmRef.current = mod;
        soaPtrRef.current = ptr;
        // Fresh pointer — cached views from a prior allocation would alias
        // the wrong memory if HEAPF32.buffer happens not to have grown.
        soaViewsRef.current = {};
        wasmReadyRef.current = true;
      })
      .catch(() => {
        // JS pool below — #390
      });
    return () => {
      cancelled = true;
      const mod = wasmRef.current;
      const ptr = soaPtrRef.current;
      if (mod && ptr) {
        mod.freeParticleSoA(ptr);
      }
      wasmRef.current = null;
      soaPtrRef.current = 0;
      soaViewsRef.current = {};
      wasmReadyRef.current = false;
    };
  }, [width, height, fanSpreadRad]);

  const particles = useMemo((): WaterfallParticle[] => {
    const temp: WaterfallParticle[] = [];
    for (let i = 0; i < MAX_POOL_JS; i++) {
      const x = (Math.random() - 0.5) * width;
      const y = Math.random() * height;
      const z = (Math.random() - 0.5) * DEPTH_Z;
      const speed = 0.2 + Math.random() * 0.3;
      const scale = 0.5 + Math.random() * 0.5;
      const randomAngle = (Math.random() - 0.5) * fanSpreadRad;
      const vx = fanSpreadRad > 0 ? Math.sin(randomAngle) * speed * 1.5 : 0;
      const vz = fanSpreadRad > 0 ? Math.cos(randomAngle) * speed * 0.3 : 0;

      temp.push({
        x, y, z, speed, scale, initialY: y, vx, vz,
        active: i < baseCount,
      });
    }
    return temp;
  }, [width, height, baseCount, fanSpreadRad]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.8, 0.8), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#e0f7fa',
    transparent: true,
    opacity: 0.6,
    roughness: 0.1,
    emissive: '#aaddff',
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  }), []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const countDiff = targetCountRef.current - currentCountRef.current;
    if (Math.abs(countDiff) > 1) {
      const change = Math.sign(countDiff) * Math.min(50, Math.abs(countDiff) * delta * 5);
      currentCountRef.current += change;
    } else {
      currentCountRef.current = targetCountRef.current;
    }

    const currentCount = Math.floor(currentCountRef.current);

    if (playerVelocity < 1.0) {
      fadeAlphaRef.current -= delta * 0.5;
      if (fadeAlphaRef.current < 0) fadeAlphaRef.current = 0;
    } else {
      fadeAlphaRef.current += delta * 2;
      if (fadeAlphaRef.current > 1) fadeAlphaRef.current = 1;
    }

    const meshMaterial = mesh.material;
    if (meshMaterial instanceof THREE.MeshStandardMaterial) {
      meshMaterial.opacity = 0.6 * fadeAlphaRef.current;
    }

    const mod = wasmRef.current;
    const ptr = soaPtrRef.current;
    if (mod && ptr) {
      seedRef.current = mod.stepWaterfallParticles(
        ptr, MAX_POOL, currentCount, delta, width, height, DEPTH_Z, seedRef.current,
      );
      const { px, py, pz, scale } = bindWaterfallViews(mod, ptr, MAX_POOL, soaViewsRef.current);
      for (let i = 0; i < currentCount; i++) {
        dummy.position.set(px[i], py[i], pz[i]);
        dummy.scale.setScalar(scale[i] * fadeAlphaRef.current);
        dummy.rotation.x += 0.05;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      for (let i = currentCount; i < MAX_POOL; i++) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    } else {
      // JS object pool — WASM SoA not loaded (#390)
      particles.forEach((p, i) => {
        if (i < currentCount) {
          p.y -= p.speed;
          if (p.vx) p.x += p.vx;
          if (p.vz) p.z += p.vz;

          if (p.y < 0) {
            p.y = height;
            p.x = (Math.random() - 0.5) * width;
            p.z = (Math.random() - 0.5) * DEPTH_Z;
          }

          dummy.position.set(p.x, p.y, p.z);
          dummy.scale.setScalar(p.scale * fadeAlphaRef.current);
          dummy.rotation.x += 0.05;
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        } else {
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
      });
    }

    mesh.instanceMatrix.needsUpdate = true;

    const light = lightRef.current;
    if (light) {
      const intensityScale = currentCount / 300;
      light.intensity = (2 + Math.sin(state.clock.elapsedTime * 10) * 0.5) * intensityScale;
      light.intensity *= fadeAlphaRef.current;
    }
  });

  return (
    <group position={[0, -height / 2, 0]}>
      <NonEmptyInstancedMesh
        ref={meshRef}
        args={[geometry, material, MAX_POOL]}
        frustumCulled={false}
      />
      <pointLight
        ref={lightRef}
        distance={20}
        color="#aaddff"
        decay={2}
        intensity={2}
      />
    </group>
  );
}
