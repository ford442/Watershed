import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeBufferGeometries } from 'three-stdlib';

const DUMMY_OBJ = new THREE.Object3D();
const TEMP_COLOR = new THREE.Color();
const MAX_ANIMATED = 24;
const SEED = 12.989;

const DRAGONFLY_PALETTE = ['#3a6ea5', '#5b8c3e', '#a83246', '#3aa0a0', '#8a5fb0'];

const hash = (n) => {
  const x = Math.sin(n * SEED) * 43758.5453;
  return x - Math.floor(x);
};

// Normalize attribute sets across geometries (fills missing attrs with zeros) before merging.
const mergeCompatibleGeometries = (geometries, useGroups = false) => {
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
    return mergeBufferGeometries(normalized, useGroups) || new THREE.BufferGeometry();
  } catch (e) {
    return new THREE.BufferGeometry();
  }
};

// Tag every vertex of a geometry with a flat "wing flap" attribute set:
// aHinge = pivot point the wing rotates around, aFlap = 0 (no flap, body/head) or +/-1 (front/back wing phase)
const paintFlap = (geo, hinge, flap) => {
  const positions = geo.attributes.position;
  const hinges = new Float32Array(positions.count * 3);
  const flaps = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    hinges[i * 3] = hinge.x;
    hinges[i * 3 + 1] = hinge.y;
    hinges[i * 3 + 2] = hinge.z;
    flaps[i] = flap;
  }
  geo.setAttribute('aHinge', new THREE.BufferAttribute(hinges, 3));
  geo.setAttribute('aFlap', new THREE.BufferAttribute(flaps, 1));
  return geo;
};

const buildWing = (width, height, hingeX, frontBack, mirrorZ) => {
  const geo = new THREE.PlaneGeometry(width, height, 2, 1);
  geo.translate(width / 2, 0, 0); // hinge edge at local x=0
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(mirrorZ < 0 ? Math.PI : 0);
  geo.translate(hingeX * (mirrorZ < 0 ? -1 : 1), 0.02, frontBack > 0 ? 0.1 : -0.05);
  paintFlap(geo, new THREE.Vector3(hingeX * (mirrorZ < 0 ? -1 : 1), 0.02, frontBack > 0 ? 0.1 : -0.05), frontBack);
  return geo;
};

export default function Dragonflies({ transforms }) {
  const meshRef = useRef();
  const trailRef = useRef();
  const stateRef = useRef([]);

  const { geometry, animatedCount } = useMemo(() => {
    // Body: tapered segmented cylinder + head sphere + small tail tip
    const bodyGeo = new THREE.CylinderGeometry(0.022, 0.012, 0.5, 6);
    bodyGeo.rotateX(Math.PI / 2);
    const headGeo = new THREE.SphereGeometry(0.045, 8, 6);
    headGeo.translate(0, 0, 0.25);
    const tailGeo = new THREE.ConeGeometry(0.012, 0.08, 5);
    tailGeo.rotateX(-Math.PI / 2);
    tailGeo.translate(0, 0, -0.29);

    [bodyGeo, headGeo, tailGeo].forEach((g) => paintFlap(g, new THREE.Vector3(0, 0, 0), 0));
    const bodyMerged = mergeCompatibleGeometries([bodyGeo, headGeo, tailGeo]);
    bodyMerged.computeVertexNormals();

    // Wings: front pair (phase +1) and back pair (phase -1), hinge at body root
    const wings = [
      buildWing(0.5, 0.13, 0.02, 1, 1),
      buildWing(0.5, 0.13, 0.02, 1, -1),
      buildWing(0.4, 0.1, 0.02, -1, 1),
      buildWing(0.4, 0.1, 0.02, -1, -1),
    ];
    const wingsMerged = mergeCompatibleGeometries(wings);
    wingsMerged.computeVertexNormals();

    const finalGeo = mergeCompatibleGeometries([bodyMerged, wingsMerged], true);

    return { geometry: finalGeo, animatedCount: 0 };
  }, []);

  const trailGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 0.05);
    geo.translate(-0.5, 0, 0); // anchor at front edge so it stretches behind
    return geo;
  }, []);

  const bodyMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#dddddd',
      roughness: 0.35,
      metalness: 0.45,
      vertexColors: false,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = `
uniform float uTime;
attribute vec3 aHinge;
attribute float aFlap;
attribute float instancePhase;
` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
#include <begin_vertex>

if (aFlap != 0.0) {
  float flapFreq = 24.0 + instancePhase * 10.0;
  float phaseOffset = aFlap > 0.0 ? 0.0 : 3.14159;
  float flapAngle = sin(uTime * flapFreq + instancePhase * 6.2831 + phaseOffset) * 0.65 + 0.15;
  vec3 rel = transformed - aHinge;
  float ca = cos(flapAngle);
  float sa = sin(flapAngle);
  vec3 rotated = vec3(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca, rel.z);
  transformed = aHinge + rotated;
}
`
      );
      mat.userData.shader = shader;
    };
    mat.needsUpdate = true;
    return mat;
  }, []);

  const wingMaterial = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#cdeeff',
      transparent: true,
      opacity: 0.32,
      roughness: 0.15,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      iridescence: 1.0,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [100, 420],
    });

    // Reuse the same flap shader injection so wings move with the body
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = `
uniform float uTime;
attribute vec3 aHinge;
attribute float aFlap;
attribute float instancePhase;
` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
#include <begin_vertex>

if (aFlap != 0.0) {
  float flapFreq = 24.0 + instancePhase * 10.0;
  float phaseOffset = aFlap > 0.0 ? 0.0 : 3.14159;
  float flapAngle = sin(uTime * flapFreq + instancePhase * 6.2831 + phaseOffset) * 0.65 + 0.15;
  vec3 rel = transformed - aHinge;
  float ca = cos(flapAngle);
  float sa = sin(flapAngle);
  vec3 rotated = vec3(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca, rel.z);
  transformed = aHinge + rotated;
}
`
      );
      mat.userData.shader = shader;
    };
    mat.needsUpdate = true;
    return mat;
  }, []);

  const trailMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#bfe9ff',
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  // Per-instance state: base position, swarm spiral params, flap phase
  const swarms = useMemo(() => {
    if (!transforms) return [];
    return transforms.map((t, i) => {
      const seed = t.position.x * 0.37 + t.position.z * 0.29 + i * 1.71;
      return {
        base: t.position.clone(),
        rotation: t.rotation || new THREE.Euler(),
        scale: t.scale ? t.scale.x : 1,
        phase: hash(seed),
        spiralRadius: 0.25 + hash(seed + 1.1) * 0.55,
        spiralSpeed: 0.6 + hash(seed + 2.2) * 1.1,
        spiralVertical: 0.1 + hash(seed + 3.3) * 0.25,
        angleOffset: hash(seed + 4.4) * Math.PI * 2,
        colorIndex: Math.floor(hash(seed + 5.5) * DRAGONFLY_PALETTE.length),
        hueJitter: (hash(seed + 6.6) - 0.5) * 0.06,
      };
    });
  }, [transforms]);

  // Set up per-instance attributes (instancePhase) and instance colors once
  useEffect(() => {
    if (!meshRef.current || !swarms.length) return;
    const mesh = meshRef.current;

    const phases = new Float32Array(swarms.length);
    swarms.forEach((s, i) => { phases[i] = s.phase; });
    mesh.geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));

    swarms.forEach((s, i) => {
      TEMP_COLOR.set(DRAGONFLY_PALETTE[s.colorIndex]);
      TEMP_COLOR.offsetHSL(s.hueJitter, 0, 0);
      mesh.setColorAt(i, TEMP_COLOR);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Initial static placement
    swarms.forEach((s, i) => {
      DUMMY_OBJ.position.copy(s.base);
      DUMMY_OBJ.rotation.copy(s.rotation);
      DUMMY_OBJ.scale.setScalar(s.scale);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    if (trailRef.current) {
      for (let i = 0; i < Math.min(swarms.length, MAX_ANIMATED); i++) {
        DUMMY_OBJ.position.set(0, -1000, 0);
        DUMMY_OBJ.scale.setScalar(0.0001);
        DUMMY_OBJ.updateMatrix();
        trailRef.current.setMatrixAt(i, DUMMY_OBJ.matrix);
      }
      trailRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [swarms]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    bodyMaterial.userData.shader && (bodyMaterial.userData.shader.uniforms.uTime.value = t);
    wingMaterial.userData.shader && (wingMaterial.userData.shader.uniforms.uTime.value = t);

    if (!meshRef.current || !swarms.length) return;
    const mesh = meshRef.current;
    const trailMesh = trailRef.current;
    const animated = Math.min(swarms.length, MAX_ANIMATED);

    for (let i = 0; i < animated; i++) {
      const s = swarms[i];
      const angle = s.angleOffset + t * s.spiralSpeed;
      const x = s.base.x + Math.cos(angle) * s.spiralRadius;
      const z = s.base.z + Math.sin(angle) * s.spiralRadius;
      const y = s.base.y + Math.sin(t * s.spiralSpeed * 1.7 + s.angleOffset) * s.spiralVertical;

      // Velocity direction (tangent to spiral) for banking orientation + trail facing
      const vx = -Math.sin(angle) * s.spiralRadius * s.spiralSpeed;
      const vz = Math.cos(angle) * s.spiralRadius * s.spiralSpeed;
      const heading = Math.atan2(vx, vz);
      const speed = Math.hypot(vx, vz);

      DUMMY_OBJ.position.set(x, y, z);
      DUMMY_OBJ.rotation.set(0, heading, Math.sin(angle * 1.3) * 0.35); // bank into the turn
      DUMMY_OBJ.scale.setScalar(s.scale);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

      if (trailMesh) {
        const trailLen = Math.min(0.6, speed * 0.5) * s.scale;
        DUMMY_OBJ.position.set(x, y, z);
        DUMMY_OBJ.rotation.set(0, heading + Math.PI, 0);
        DUMMY_OBJ.scale.set(trailLen, s.scale, 1);
        DUMMY_OBJ.updateMatrix();
        trailMesh.setMatrixAt(i, DUMMY_OBJ.matrix);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (trailMesh) {
      trailMesh.instanceMatrix.needsUpdate = true;
      trailMaterial.opacity = 0.18;
    }
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, [bodyMaterial, wingMaterial], transforms.length]}
        frustumCulled={false}
        castShadow
      />
      <instancedMesh
        ref={trailRef}
        args={[trailGeometry, trailMaterial, Math.min(transforms.length, MAX_ANIMATED)]}
        frustumCulled={false}
      />
    </group>
  );
}
