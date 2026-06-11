import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeBufferGeometries } from 'three-stdlib';
import { WATER_LEVEL } from '../../constants/game';

const DUMMY_OBJ = new THREE.Object3D();
const TEMP_COLOR = new THREE.Color();
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const TEMP_VEL = new THREE.Vector3();
const TEMP_QUAT = new THREE.Quaternion();
const TILT_QUAT = new THREE.Quaternion();
const TILT_AXIS = new THREE.Vector3(1, 0, 0);

const MAX_ANIMATED = 36;
const SEED = 6.911;

const SILVER_PALETTE = ['#c9d8e0', '#aebfca', '#b8ccd6', '#d4e2e8'];
const DARK_PALETTE = ['#3a3324', '#46402c', '#33422f', '#3e3b2a'];
const RING_DUMMY = new THREE.Object3D();
const RING_LIFETIME = 1.0;

const hash = (n) => {
  const x = Math.sin(n * SEED) * 43758.5453;
  return x - Math.floor(x);
};

// Normalize attribute sets across geometries (fills missing attrs with zeros) before merging.
const mergeCompatibleGeometries = (geometries) => {
  if (!geometries.length) return new THREE.BufferGeometry();
  const normalized = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  const attrNames = new Set();
  normalized.forEach((g) => Object.keys(g.attributes).forEach((n) => attrNames.add(n)));
  normalized.forEach((g) => {
    attrNames.forEach((name) => {
      if (!g.getAttribute(name)) {
        const ref = normalized.find((h) => h.getAttribute(name)).getAttribute(name);
        g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * ref.itemSize), ref.itemSize));
      }
    });
  });
  try {
    return mergeBufferGeometries(normalized) || new THREE.BufferGeometry();
  } catch (e) {
    return new THREE.BufferGeometry();
  }
};

// Tag each vertex with how strongly the swim-wiggle wave should affect it,
// based on how far back (toward -Z, the tail) the vertex sits.
const paintTailWeight = (geo) => {
  const positions = geo.attributes.position;
  const weights = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getZ(i);
    weights[i] = THREE.MathUtils.smoothstep(-z, -0.05, 0.95);
  }
  geo.setAttribute('aTailWeight', new THREE.BufferAttribute(weights, 1));
  return geo;
};

export default function Fish({ transforms }) {
  const meshRef = useRef();
  const ringRef = useRef();

  // Body: nose-to-mid frustum + mid-to-tail frustum + flattened tail fin + dorsal fin
  const geometry = useMemo(() => {
    const front = new THREE.CylinderGeometry(0.04, 0.2, 0.5, 8);
    front.rotateX(Math.PI / 2);
    front.translate(0, 0, 0.25);

    const back = new THREE.CylinderGeometry(0.2, 0.05, 0.6, 8);
    back.rotateX(Math.PI / 2);
    back.translate(0, 0, -0.3);

    const tailFin = new THREE.ConeGeometry(0.26, 0.4, 4);
    tailFin.rotateX(Math.PI / 2);
    tailFin.rotateY(Math.PI / 4);
    tailFin.scale(1, 0.18, 1);
    tailFin.translate(0, 0, -0.78);

    const dorsalFin = new THREE.PlaneGeometry(0.32, 0.18);
    dorsalFin.rotateY(Math.PI / 2);
    dorsalFin.translate(0, 0.18, -0.05);

    [front, back, tailFin, dorsalFin].forEach((g) => g.computeVertexNormals());

    const merged = mergeCompatibleGeometries([front, back, tailFin, dorsalFin]);
    merged.computeVertexNormals();
    paintTailWeight(merged);
    return merged;
  }, []);

  const ringGeometry = useMemo(() => {
    const geo = new THREE.RingGeometry(0.3, 0.5, 20);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const ringMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#dff6ff',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
attribute float ringAlpha;
varying float vRingAlpha;
` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvRingAlpha = ringAlpha;`
      );

      shader.fragmentShader = `varying float vRingAlpha;\n` + shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\ngl_FragColor.a *= vRingAlpha;`
      );
    };
    mat.needsUpdate = true;
    return mat;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.35,
      metalness: 0.25,
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = `
uniform float uTime;
attribute float aTailWeight;
attribute float instancePhase;
attribute float instanceFreq;
` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
#include <begin_vertex>

float swimWave = sin(uTime * instanceFreq + instancePhase * 6.2831 + transformed.z * -3.0);
transformed.x += swimWave * 0.16 * aTailWeight;
`
      );

      mat.userData.shader = shader;
    };
    mat.needsUpdate = true;
    return mat;
  }, []);

  // Per-fish behaviour state: base transform, schooling wander params, jump timing
  const fish = useMemo(() => {
    if (!transforms) return [];
    return transforms.map((t, i) => {
      const seed = t.position.x * 0.43 + t.position.z * 0.31 + i * 1.61;
      const isSilver = hash(seed) > 0.45;
      const palette = isSilver ? SILVER_PALETTE : DARK_PALETTE;
      const color = new THREE.Color(palette[Math.floor(hash(seed + 1.3) * palette.length)]);
      color.multiplyScalar(0.85 + hash(seed + 2.6) * 0.3);

      return {
        base: t.position.clone(),
        rotation: t.rotation || new THREE.Euler(),
        scale: t.scale ? t.scale.x : 1,
        color,
        phase: hash(seed + 3.9),
        freq: 4.0 + hash(seed + 5.2) * 3.0,
        wanderRadius: 0.3 + hash(seed + 6.5) * 0.7,
        wanderSpeed: 0.25 + hash(seed + 7.8) * 0.5,
        angleOffset: hash(seed + 9.1) * Math.PI * 2,
        jumpPeriod: 20 + hash(seed + 10.4) * 20,
        jumpStart: hash(seed + 11.7) * 40,
        nearSurface: t.position.y > WATER_LEVEL - 1.0,
        wasJumping: false,
        ringLife: 0,
        ringX: 0,
        ringZ: 0,
      };
    });
  }, [transforms]);

  useEffect(() => {
    if (!meshRef.current || !fish.length) return;
    const mesh = meshRef.current;

    const phases = new Float32Array(fish.length);
    const freqs = new Float32Array(fish.length);
    fish.forEach((f, i) => {
      phases[i] = f.phase;
      freqs[i] = f.freq;
      TEMP_COLOR.copy(f.color);
      mesh.setColorAt(i, TEMP_COLOR);
    });
    mesh.geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.geometry.setAttribute('instanceFreq', new THREE.InstancedBufferAttribute(freqs, 1));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    fish.forEach((f, i) => {
      DUMMY_OBJ.position.copy(f.base);
      DUMMY_OBJ.rotation.copy(f.rotation);
      DUMMY_OBJ.scale.setScalar(f.scale);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    if (ringRef.current) {
      const animated = Math.min(fish.length, MAX_ANIMATED);
      const alphas = new Float32Array(animated);
      ringRef.current.geometry.setAttribute('ringAlpha', new THREE.InstancedBufferAttribute(alphas, 1));
      for (let i = 0; i < animated; i++) {
        RING_DUMMY.position.set(0, -1000, 0);
        RING_DUMMY.scale.setScalar(0.0001);
        RING_DUMMY.updateMatrix();
        ringRef.current.setMatrixAt(i, RING_DUMMY.matrix);
      }
      ringRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [fish]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (material.userData.shader) {
      material.userData.shader.uniforms.uTime.value = t;
    }

    if (!meshRef.current || !fish.length) return;
    const mesh = meshRef.current;
    const ring = ringRef.current;
    const animated = Math.min(fish.length, MAX_ANIMATED);
    const ringAlphas = ring?.geometry.attributes.ringAlpha;
    let ringsChanged = false;

    for (let i = 0; i < animated; i++) {
      const f = fish[i];
      const angle = f.angleOffset + t * f.wanderSpeed;
      let x = f.base.x + Math.cos(angle) * f.wanderRadius;
      let y = f.base.y;
      let z = f.base.z + Math.sin(angle * 0.9) * f.wanderRadius;

      const vx = -Math.sin(angle) * f.wanderRadius * f.wanderSpeed;
      const vz = Math.cos(angle * 0.9) * f.wanderRadius * f.wanderSpeed * 0.9;

      let pitch = 0;
      let isJumping = false;
      if (f.nearSurface) {
        const cycleTime = ((t + f.jumpStart) % f.jumpPeriod);
        const jumpDuration = 0.9;
        if (cycleTime < jumpDuration) {
          isJumping = true;
          const arc = Math.sin((cycleTime / jumpDuration) * Math.PI);
          y += arc * 1.1;
          pitch = arc * 0.6 * (cycleTime < jumpDuration / 2 ? 1 : -1);
        }
      }

      // Landing: spawn a ripple ring on the water surface where the fish re-enters
      if (f.wasJumping && !isJumping) {
        f.ringLife = RING_LIFETIME;
        f.ringX = x;
        f.ringZ = z;
      }
      f.wasJumping = isJumping;

      TEMP_VEL.set(vx, 0, vz);
      if (TEMP_VEL.lengthSq() < 1e-5) TEMP_VEL.set(0, 0, 1);
      TEMP_VEL.normalize();
      TEMP_QUAT.setFromUnitVectors(LOCAL_FORWARD, TEMP_VEL);

      if (pitch !== 0) {
        TILT_QUAT.setFromAxisAngle(TILT_AXIS, pitch);
        TEMP_QUAT.multiply(TILT_QUAT);
      }

      DUMMY_OBJ.position.set(x, y, z);
      DUMMY_OBJ.quaternion.copy(TEMP_QUAT);
      DUMMY_OBJ.scale.setScalar(f.scale);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

      // Animate the splash ring for this fish slot, if active
      if (ring && ringAlphas) {
        if (f.ringLife > 0) {
          f.ringLife = Math.max(0, f.ringLife - delta);
          const age = 1 - f.ringLife / RING_LIFETIME;
          const ringScale = 0.2 + age * 1.6;
          RING_DUMMY.position.set(f.ringX, WATER_LEVEL + 0.01, f.ringZ);
          RING_DUMMY.scale.setScalar(ringScale);
          RING_DUMMY.updateMatrix();
          ring.setMatrixAt(i, RING_DUMMY.matrix);
          ringAlphas.array[i] = (1 - age) * 0.6;
        } else if (ringAlphas.array[i] !== 0) {
          ringAlphas.array[i] = 0;
        }
        ringsChanged = true;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (ring && ringsChanged) {
      ring.instanceMatrix.needsUpdate = true;
      ringAlphas.needsUpdate = true;
    }
  });

  if (!fish.length) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, fish.length]}
        frustumCulled={false}
        castShadow
      />
      <instancedMesh
        ref={ringRef}
        args={[ringGeometry, ringMaterial, Math.min(fish.length, MAX_ANIMATED)]}
        frustumCulled={false}
      />
    </group>
  );
}
