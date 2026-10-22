import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BiomeDecorationProps } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createFireflyMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';
import { NonEmptyInstancedMesh } from '../../rendering/instancing/NonEmptyInstancedMesh';
import { usePooledPointLights } from '../../rendering/sceneLightPool';
import { sinHash } from '../../math/hash';

const DUMMY_OBJ = new THREE.Object3D();
const MAX_LIGHTS = 5;
const SEED = 8.731;
const GLOW_LIGHT = { color: '#ffdd55', distance: 3, decay: 2 } as const;

const hash = (n: number): number => sinHash(n * SEED);

export default function Fireflies({ transforms }: BiomeDecorationProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => new THREE.TetrahedronGeometry(0.1, 0), []);

  const material = useMemo(
    () => createFireflyMaterial(resolveMaterialBackend().backend, { colorBase: new THREE.Color('#ffdd55') }),
    [],
  );

  const glowFireflies = useMemo(() => {
    if (!transforms || transforms.length === 0) return [];
    const count = Math.min(transforms.length, MAX_LIGHTS);
    const step = Math.max(1, Math.floor(transforms.length / count));
    const picked = [];
    for (let i = 0; i < transforms.length && picked.length < count; i += step) {
      const t = transforms[i];
      const seed = t.position.x * 0.51 + t.position.z * 0.27 + i * 1.13;
      picked.push({
        base: t.position.clone(),
        rand: hash(seed),
        rand2: hash(seed + 3.7),
        swarmSpeed: 0.4 + hash(seed + 3.7) * 0.6,
        swarmRadius: 0.4 + hash(seed) * 0.9,
        floatSpeed: 0.5 + hash(seed) * 0.5,
        floatAmp: 0.3 + hash(seed) * 0.35,
        blinkSpeed: 2.0 + hash(seed) * 3.0,
        blinkPhase: hash(seed) * 10.0,
      });
    }
    return picked;
  }, [transforms]);

  // Glow lights are borrowed from the scene's fixed pool: a segment mounting
  // its own <pointLight>s recompiled every lit material in the scene (#487).
  const glowLights = usePooledPointLights(glowFireflies.length, GLOW_LIGHT);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const u = materialUniformBag(material);
    if (u?.time) u.time.value = time;

    const group = groupRef.current;
    glowFireflies.forEach((f, i) => {
      const light = glowLights[i];
      if (!light || !group) return;

      const swarmAngle = time * f.swarmSpeed + f.rand * 6.2831;
      const x = f.base.x + Math.cos(swarmAngle) * f.swarmRadius + Math.sin(time * f.floatSpeed + f.rand * 10.0) * f.floatAmp;
      const y = f.base.y + Math.sin(time * f.floatSpeed * 1.3 + f.rand2 * 10.0) * f.floatAmp * 0.6 + Math.sin(swarmAngle * 1.5) * 0.25;
      const z = f.base.z + Math.sin(swarmAngle) * f.swarmRadius + Math.cos(time * f.floatSpeed * 0.8 + f.rand * 20.0) * f.floatAmp;

      group.localToWorld(light.position.set(x, y, z));

      let blink = Math.sin(time * f.blinkSpeed + f.blinkPhase);
      blink = THREE.MathUtils.smoothstep(blink, -0.2, 0.8);
      light.intensity = (0.3 + 0.7 * blink) * 0.6;
    });
  });

  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.set(0, 0, 0);
      DUMMY_OBJ.scale.setScalar(1.0);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <group ref={groupRef}>
      <NonEmptyInstancedMesh ref={meshRef} args={[geometry, material, transforms.length]} frustumCulled={false} />
    </group>
  );
}
