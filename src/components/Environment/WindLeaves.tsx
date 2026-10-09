/**
 * WindLeaves — wind-blown leaves in the autumn sections (#464).
 *
 * One InstancedMesh in a box that travels with the camera. Leaves ride a
 * global, gusting wind vector with a little flutter and tumble; one that
 * drifts out of the box re-enters on the upwind side. No Rapier colliders,
 * no simulation beyond that — it is a readable, not physics.
 *
 * Density is zero outside autumn-like biomes; a storm (the `weather-update`
 * broadcast) thickens it and doubles the wind. Everything per frame mutates
 * module scratch or preallocated typed arrays — no allocation in the loop.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { isAutumnLike } from '../../configs/biomes';
import { useGameStore } from '../../systems/GameState';
import { resolveLeafPalette } from './FallingLeaves';

export const WIND_LEAVES_MAX = 220;
/** Fraction of WIND_LEAVES_MAX shown in calm autumn / in an autumn storm. */
export const WIND_LEAVES_DENSITY = { calm: 0.35, storm: 1 } as const;
/** Half-extents of the box around the camera (m). */
const BOX = { x: 14, y: 7, z: 20 } as const;
const BASE_WIND = { x: 2.2, z: 0.9 } as const;
const FALL_SPEED = 0.55;

const DUMMY = new THREE.Object3D();
const SCRATCH_COLOR = new THREE.Color();

/** Leaves to show for a biome and storm transition (0..1). */
export function windLeavesCount(biome: string, stormTransition: number): number {
  if (!isAutumnLike(biome)) return 0;
  const s = Math.min(1, Math.max(0, stormTransition));
  const density = WIND_LEAVES_DENSITY.calm + (WIND_LEAVES_DENSITY.storm - WIND_LEAVES_DENSITY.calm) * s;
  return Math.round(density * WIND_LEAVES_MAX);
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export default function WindLeaves() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const biome = useGameStore((s) => s.currentBiome);
  const stormRef = useRef(0);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.22, 0.16), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Per-leaf state: offset from the camera (xyz), flutter phase, spin rates (xyz).
  const leaves = useMemo(() => {
    const rng = makeRng(0x1eaf);
    const offset = new Float32Array(WIND_LEAVES_MAX * 3);
    const phase = new Float32Array(WIND_LEAVES_MAX);
    const spin = new Float32Array(WIND_LEAVES_MAX * 3);
    for (let i = 0; i < WIND_LEAVES_MAX; i += 1) {
      offset[i * 3] = (rng() * 2 - 1) * BOX.x;
      offset[i * 3 + 1] = (rng() * 2 - 1) * BOX.y;
      offset[i * 3 + 2] = (rng() * 2 - 1) * BOX.z;
      phase[i] = rng() * Math.PI * 2;
      spin[i * 3] = 1 + rng() * 3;
      spin[i * 3 + 1] = 0.5 + rng() * 2;
      spin[i * 3 + 2] = 1 + rng() * 4;
    }
    return { offset, phase, spin, rng };
  }, []);

  // Storm state from the WeatherSystem broadcast — a ref, not React state.
  useEffect(() => {
    const onWeather = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; transition?: number; intensity?: number }>).detail;
      if (!detail) return;
      stormRef.current = detail.type === 'storm' ? detail.transition ?? detail.intensity ?? 1 : 0;
    };
    window.addEventListener('weather-update', onWeather);
    return () => window.removeEventListener('weather-update', onWeather);
  }, []);

  // Colours once per biome (not per frame).
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const palette = resolveLeafPalette(biome);
    for (let i = 0; i < WIND_LEAVES_MAX; i += 1) {
      mesh.setColorAt(i, SCRATCH_COLOR.set(palette[i % palette.length]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [biome]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const count = windLeavesCount(biome, stormRef.current);
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;

    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const storm = stormRef.current;
    const gust = 0.7 + 0.3 * Math.sin(t * 0.7) + 0.15 * Math.sin(t * 2.3 + 1.2);
    const windScale = gust * (1 + storm);
    const windX = BASE_WIND.x * windScale;
    const windZ = BASE_WIND.z * windScale;
    const cam = state.camera.position;
    const { offset, phase, spin, rng } = leaves;

    for (let i = 0; i < count; i += 1) {
      const o = i * 3;
      const p = phase[i];
      offset[o] += (windX + Math.sin(t * 2.1 + p) * 0.6) * dt;
      offset[o + 1] += (-FALL_SPEED + Math.sin(t * 3.3 + p * 1.7) * 0.5) * dt;
      offset[o + 2] += (windZ + Math.cos(t * 1.7 + p) * 0.5) * dt;

      // Out of the box: re-enter on the upwind (−X) side at a fresh height / depth.
      if (offset[o] > BOX.x || offset[o + 1] < -BOX.y || Math.abs(offset[o + 2]) > BOX.z) {
        offset[o] = -BOX.x;
        offset[o + 1] = (rng() * 2 - 1) * BOX.y;
        offset[o + 2] = (rng() * 2 - 1) * BOX.z;
      }

      DUMMY.position.set(cam.x + offset[o], cam.y + offset[o + 1], cam.z + offset[o + 2]);
      DUMMY.rotation.set(t * spin[o] + p, t * spin[o + 1], t * spin[o + 2] + p);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(i, DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, WIND_LEAVES_MAX]}
      frustumCulled={false}
      visible={false}
    />
  );
}
