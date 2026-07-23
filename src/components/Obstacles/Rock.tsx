import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { InstancedRigidBodies, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { extendRockMaterial } from '../../utils/RockShader';
import {
  buildPillarFragments,
  evaluatePillarImpact,
  isPlayerRigidBody,
  PILLAR_CRACK_DURATION_S,
  PILLAR_FRAGMENT_COUNT_MAX,
  PILLAR_FRAGMENT_COUNT_MIN,
  type PillarPhase,
  vec3FromRapier,
} from './pillarCrumble';
import { emitPillarBreak } from './pillarBreakEvents';
import { enqueuePillarFragments } from './PillarFragmentPool';
import { tryAcquirePillarFragmentSlots } from '../../systems/PillarFragmentRegistry';

const VARIANTS_BY_TYPE = {
  boulder: ['boulderRiverworn', 'boulderAngular'],
  slab: ['slab'],
  column: ['columnFractured', 'columnLayered'],
} as const;

const SCATTER_VARIANTS_BY_TYPE = {
  boulder: ['boulderRiverworn', 'boulderAngular'],
  slab: ['slab'],
  column: ['scree'],
} as const;

const VARIANT_SHADER_OPTIONS: Record<
  string,
  {
    mossStrength: number;
    streakStrength: number;
    bandStrength: number;
    bandScale?: number;
    dustStrength: number;
    rimStrength: number;
    wetnessRange?: number;
  }
> = {
  boulderRiverworn: {
    mossStrength: 0.55,
    streakStrength: 0.15,
    bandStrength: 0.0,
    dustStrength: 0.1,
    rimStrength: 0.2,
    wetnessRange: 3.0,
  },
  boulderAngular: {
    mossStrength: 0.2,
    streakStrength: 0.45,
    bandStrength: 0.0,
    dustStrength: 0.18,
    rimStrength: 0.35,
    wetnessRange: 2.0,
  },
  slab: {
    mossStrength: 0.25,
    streakStrength: 0.2,
    bandStrength: 0.6,
    bandScale: 3.0,
    dustStrength: 0.25,
    rimStrength: 0.2,
  },
  columnFractured: {
    mossStrength: 0.15,
    streakStrength: 0.5,
    bandStrength: 0.2,
    bandScale: 1.6,
    dustStrength: 0.1,
    rimStrength: 0.4,
  },
  columnLayered: {
    mossStrength: 0.3,
    streakStrength: 0.2,
    bandStrength: 0.75,
    bandScale: 4.2,
    dustStrength: 0.15,
    rimStrength: 0.25,
  },
  scree: {
    mossStrength: 0.35,
    streakStrength: 0.1,
    bandStrength: 0.0,
    dustStrength: 0.45,
    rimStrength: 0.15,
    wetnessRange: 1.5,
  },
};

export interface RockTransform {
  key?: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  rockType?: string;
  color?: string;
  /** Authored seg-22 pillars that break apart at speed. */
  crumbling?: boolean;
  pillarIndex?: number;
  segmentId?: number;
  variant?: string;
}

export interface RockProps {
  transforms?: RockTransform[];
  scatterTransforms?: RockTransform[];
  material?: THREE.MeshStandardMaterial;
  castShadow?: boolean;
}

const displaceGeometry = (geometry: THREE.BufferGeometry, seed: number, amount = 0.18, yScale = 1) => {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const vertex = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    vertexNormal.fromBufferAttribute(normal, i);
    const wave =
      Math.sin(vertex.x * 3.7 + seed) +
      Math.cos(vertex.y * 4.9 - seed * 0.5) +
      Math.sin(vertex.z * 5.3 + seed * 1.7);
    vertex.addScaledVector(vertexNormal, (wave / 3) * amount);
    vertex.y *= yScale;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
};

const layerColumnGeometry = (geometry: THREE.BufferGeometry, seed = 0) => {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const vertex = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    vertexNormal.fromBufferAttribute(normal, i);
    const band = Math.floor((vertex.y + seed) * 2.2);
    const bandOffset = band % 2 === 0 ? 0.045 : -0.035;
    const noise = Math.sin(vertex.x * 6.1 + seed) * 0.02;
    vertex.addScaledVector(vertexNormal, bandOffset + noise);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
};

function useGeometryLibrary() {
  return useMemo(() => {
    const boulderRiverworn = displaceGeometry(new THREE.IcosahedronGeometry(1, 2), 0.7, 0.1, 0.92);
    const boulderAngular = displaceGeometry(new THREE.IcosahedronGeometry(1, 1), 2.4, 0.26, 0.95);
    const slab = displaceGeometry(new THREE.DodecahedronGeometry(1, 0), 1.9, 0.12, 0.42);
    slab.scale(1.45, 0.65, 1.15);
    slab.computeVertexNormals();

    const columnFractured = new THREE.CylinderGeometry(0.62, 0.82, 3.2, 7, 3);
    displaceGeometry(columnFractured, 3.3, 0.1, 1);
    columnFractured.translate(0, 1.6, 0);
    columnFractured.computeVertexNormals();

    const columnLayered = new THREE.CylinderGeometry(0.7, 0.9, 3.4, 8, 6);
    layerColumnGeometry(columnLayered, 1.2);
    columnLayered.translate(0, 1.7, 0);
    columnLayered.computeVertexNormals();

    const scree = displaceGeometry(new THREE.IcosahedronGeometry(0.35, 0), 4.2, 0.1, 0.75);

    return { boulderRiverworn, boulderAngular, slab, columnFractured, columnLayered, scree };
  }, []);
}

interface CrumblingColumnProps {
  transform: RockTransform;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
}

/**
 * Per-instance pillar state machine: intact → cracking → shattered.
 * Health lives in a typed side-array (pillarPhaseByIndex), not Zustand.
 */
function CrumblingColumn({ transform, geometry, material, castShadow }: CrumblingColumnProps) {
  const { rapier } = useRapier();
  const meshRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<RapierRigidBody>(null);
  const pillarIndex = transform.pillarIndex ?? 0;
  const segmentId = transform.segmentId ?? 0;

  // Module-scoped phase table keyed by segment + pillar index (survives re-renders).
  const phaseTableRef = useRef<Map<string, PillarPhase>>(new Map());
  const crackStartRef = useRef(0);
  const shatterTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<PillarPhase>(() => {
    const key = `${segmentId}:${pillarIndex}`;
    return phaseTableRef.current.get(key) ?? 'intact';
  });

  const phaseKey = `${segmentId}:${pillarIndex}`;

  const setPillarPhase = useCallback(
    (next: PillarPhase) => {
      phaseTableRef.current.set(phaseKey, next);
      setPhase(next);
    },
    [phaseKey],
  );

  const shatter = useCallback(
    (impactPoint: THREE.Vector3, playerSpeed: number, impactDir: THREE.Vector3) => {
      const requested =
        PILLAR_FRAGMENT_COUNT_MIN +
        Math.floor(
          ((segmentId * 17 + pillarIndex * 31) % 100) / 100 *
            (PILLAR_FRAGMENT_COUNT_MAX - PILLAR_FRAGMENT_COUNT_MIN + 1),
        );
      const granted = tryAcquirePillarFragmentSlots(requested);
      if (granted > 0) {
        const spawns = buildPillarFragments({
          center: transform.position.clone(),
          columnScale: transform.scale.clone(),
          impactDir,
          seed: segmentId * 1000 + pillarIndex,
          count: granted,
        });
        enqueuePillarFragments(spawns);
      }

      emitPillarBreak({
        segmentIndex: segmentId,
        pillarIndex,
        impactPoint: vec3FromRapier(impactPoint),
        impactSpeed: playerSpeed,
        fragmentCount: granted,
      });

      setPillarPhase('shattered');
    },
    [pillarIndex, segmentId, setPillarPhase, transform.position, transform.scale],
  );

  const handleCollisionEnter = useCallback(
    ({ other, manifold }: { other: { rigidBody?: RapierRigidBody | null }; manifold: { solverContactPoint: (i: number) => { x: number; y: number; z: number } } }) => {
      const otherBody = other.rigidBody;
      if (!otherBody || !isPlayerRigidBody(otherBody, rapier.RigidBodyType.Dynamic)) return;

      const vel = otherBody.linvel();
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      const result = evaluatePillarImpact({ playerSpeed: speed, phase });

      if (!result.shouldCrack) return;

      const contact = manifold.solverContactPoint(0);
      const impactPoint = new THREE.Vector3(contact.x, contact.y, contact.z);
      const impactDir = new THREE.Vector3(vel.x, 0, vel.z);
      if (impactDir.lengthSq() < 1e-4) {
        impactDir.set(0, 0, -1);
      } else {
        impactDir.normalize();
      }

      crackStartRef.current = performance.now() / 1000;
      setPillarPhase('cracking');

      if (shatterTimerRef.current !== null) {
        window.clearTimeout(shatterTimerRef.current);
      }
      shatterTimerRef.current = window.setTimeout(() => {
        shatterTimerRef.current = null;
        if (phaseTableRef.current.get(phaseKey) === 'cracking') {
          shatter(impactPoint, speed, impactDir);
        }
      }, PILLAR_CRACK_DURATION_S * 1000);
    },
    [phase, phaseKey, rapier.RigidBodyType.Dynamic, setPillarPhase, shatter],
  );

  useEffect(() => {
    return () => {
      if (shatterTimerRef.current !== null) {
        window.clearTimeout(shatterTimerRef.current);
      }
    };
  }, []);

  useFrame(() => {
    if (phase !== 'cracking' || !meshRef.current) return;
    const elapsed = performance.now() / 1000 - crackStartRef.current;
    const wobble = 1 + Math.sin(elapsed * 80) * 0.015 * Math.min(1, elapsed / PILLAR_CRACK_DURATION_S);
    meshRef.current.scale.set(
      transform.scale.x * wobble,
      transform.scale.y * wobble,
      transform.scale.z * wobble,
    );
  });

  if (phase === 'shattered') return null;

  return (
    <RigidBody
      ref={bodyRef}
      type="fixed"
      colliders="hull"
      position={[transform.position.x, transform.position.y, transform.position.z]}
      rotation={[transform.rotation.x, transform.rotation.y, transform.rotation.z]}
      onCollisionEnter={handleCollisionEnter}
    >
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
        castShadow={castShadow}
        receiveShadow
      />
    </RigidBody>
  );
}

export default function Rock({
  transforms = [],
  scatterTransforms = [],
  material,
  castShadow = true,
}: RockProps) {
  const collidableRefs = useRef<Record<string, THREE.InstancedMesh>>({});
  const scatterRefs = useRef<Record<string, THREE.InstancedMesh>>({});

  const geometryLibrary = useGeometryLibrary();

  const materialLibrary = useMemo(() => {
    const library: Record<string, THREE.MeshStandardMaterial> = {};
    Object.entries(VARIANT_SHADER_OPTIONS).forEach(([variant, options]) => {
      const clone = material
        ? material.clone()
        : new THREE.MeshStandardMaterial({ color: '#888', roughness: 0.9 });
      extendRockMaterial(clone, options);
      library[variant] = clone;
    });
    return library;
  }, [material]);

  const { crumblingColumns, staticTransforms } = useMemo(() => {
    const crumbling: RockTransform[] = [];
    const staticList: RockTransform[] = [];
    transforms.forEach((t, i) => {
      if (t.crumbling && t.rockType === 'column') {
        crumbling.push({ ...t, pillarIndex: t.pillarIndex ?? i });
      } else {
        staticList.push(t);
      }
    });
    return { crumblingColumns: crumbling, staticTransforms: staticList };
  }, [transforms]);

  const collidableGroups = useMemo(() => {
    const grouped: Record<string, RockTransform[]> = { boulder: [], slab: [], column: [] };
    staticTransforms.forEach((t, i) => {
      const rockType = grouped[t.rockType ?? ''] ? (t.rockType as string) : 'boulder';
      grouped[rockType].push({ key: `rock-${rockType}-${i}`, ...t });
    });

    const byVariant: Record<string, RockTransform[]> = {};
    Object.entries(grouped).forEach(([rockType, instances]) => {
      const variants = VARIANTS_BY_TYPE[rockType as keyof typeof VARIANTS_BY_TYPE] ?? VARIANTS_BY_TYPE.boulder;
      instances.forEach((instance, i) => {
        const variant = variants[i % variants.length];
        if (!byVariant[variant]) byVariant[variant] = [];
        byVariant[variant].push({ ...instance, variant });
      });
    });
    return byVariant;
  }, [staticTransforms]);

  const scatterGroups = useMemo(() => {
    const grouped: Record<string, RockTransform[]> = { boulder: [], slab: [], column: [] };
    scatterTransforms.forEach((t, i) => {
      const rockType = grouped[t.rockType ?? ''] ? (t.rockType as string) : 'boulder';
      grouped[rockType].push({ key: `scatter-${rockType}-${i}`, ...t });
    });

    const byVariant: Record<string, RockTransform[]> = {};
    Object.entries(grouped).forEach(([rockType, instances]) => {
      const variants =
        SCATTER_VARIANTS_BY_TYPE[rockType as keyof typeof SCATTER_VARIANTS_BY_TYPE] ??
        SCATTER_VARIANTS_BY_TYPE.boulder;
      instances.forEach((instance, i) => {
        const variant = variants[i % variants.length];
        if (!byVariant[variant]) byVariant[variant] = [];
        byVariant[variant].push({ ...instance, variant });
      });
    });
    return byVariant;
  }, [scatterTransforms]);

  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();

    Object.entries(collidableGroups).forEach(([variant, instances]) => {
      const mesh = collidableRefs.current[variant];
      if (!mesh) return;
      instances.forEach((instance, index) => {
        quaternion.setFromEuler(instance.rotation);
        matrix.compose(instance.position, quaternion, instance.scale);
        mesh.setMatrixAt(index, matrix);
        if (instance.color) {
          color.set(instance.color);
          mesh.setColorAt(index, color);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });

    Object.entries(scatterGroups).forEach(([variant, instances]) => {
      const mesh = scatterRefs.current[variant];
      if (!mesh) return;
      instances.forEach((instance, index) => {
        quaternion.setFromEuler(instance.rotation);
        matrix.compose(instance.position, quaternion, instance.scale);
        mesh.setMatrixAt(index, matrix);
        if (instance.color) {
          color.set(instance.color);
          mesh.setColorAt(index, color);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [collidableGroups, scatterGroups]);

  if (transforms.length === 0 && scatterTransforms.length === 0) return null;

  return (
    <group>
      {crumblingColumns.map((column) => {
        const variant =
          column.variant ??
          VARIANTS_BY_TYPE.column[(column.pillarIndex ?? 0) % VARIANTS_BY_TYPE.column.length];
        const geometryKey =
          variant === 'columnFractured' || variant === 'columnLayered' ? variant : 'columnFractured';
        return (
          <CrumblingColumn
            key={`crumble-${column.segmentId ?? 0}-${column.pillarIndex ?? 0}`}
            transform={column}
            geometry={geometryLibrary[geometryKey as keyof typeof geometryLibrary]}
            material={materialLibrary[variant]}
            castShadow={castShadow}
          />
        );
      })}

      {Object.entries(collidableGroups).map(([variant, instances]) => {
        if (!instances.length) return null;
        const geometryKey =
          variant === 'columnFractured' || variant === 'columnLayered'
            ? variant
            : variant === 'slab'
              ? 'slab'
              : variant;

        return (
          <InstancedRigidBodies
            key={`rigid-${variant}`}
            instances={instances.map((instance, index) => ({
              key: instance.key ?? `rigid-${variant}-${index}`,
              position: [instance.position.x, instance.position.y, instance.position.z] as [number, number, number],
              rotation: [instance.rotation.x, instance.rotation.y, instance.rotation.z] as [number, number, number],
              scale: [instance.scale.x, instance.scale.y, instance.scale.z] as [number, number, number],
            }))}
            type="fixed"
            colliders={variant === 'slab' ? 'cuboid' : 'hull'}
          >
            <instancedMesh
              ref={(node) => {
                if (node) collidableRefs.current[variant] = node;
                else delete collidableRefs.current[variant];
              }}
              args={[geometryLibrary[geometryKey as keyof typeof geometryLibrary], materialLibrary[variant], instances.length]}
              castShadow={castShadow}
              receiveShadow
            />
          </InstancedRigidBodies>
        );
      })}

      {Object.entries(scatterGroups).map(([variant, instances]) => {
        if (!instances.length) return null;

        return (
          <instancedMesh
            key={`scatter-${variant}`}
            ref={(node) => {
              if (node) scatterRefs.current[variant] = node;
              else delete scatterRefs.current[variant];
            }}
            args={[geometryLibrary[variant as keyof typeof geometryLibrary], materialLibrary[variant], instances.length]}
            castShadow={castShadow}
            receiveShadow
          />
        );
      })}
    </group>
  );
}
