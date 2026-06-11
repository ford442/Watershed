import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies } from '@react-three/rapier';
import { extendRockMaterial } from '../../utils/RockShader';

const ROCK_TYPES = ['boulder', 'slab', 'column'];

// Each base rockType is split into two geological "personalities" so a single
// chunk of scattered boulders/columns doesn't read as identical clones.
const VARIANTS_BY_TYPE = {
  boulder: ['boulderRiverworn', 'boulderAngular'],
  slab: ['slab'],
  column: ['columnFractured', 'columnLayered'],
};

// Scatter (non-collidable) instances use the same personalities, except
// scattered "columns" become loose scree/talus rather than tall columns.
const SCATTER_VARIANTS_BY_TYPE = {
  boulder: ['boulderRiverworn', 'boulderAngular'],
  slab: ['slab'],
  column: ['scree'],
};

// Per-variant RockShader options: each personality gets its own mix of
// moss/lichen, iron-oxide streaks, sedimentary banding, dust and rim light.
const VARIANT_SHADER_OPTIONS = {
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

const displaceGeometry = (geometry, seed, amount = 0.18, yScale = 1) => {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const vertex = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    vertexNormal.fromBufferAttribute(normal, i);
    const wave = Math.sin(vertex.x * 3.7 + seed) + Math.cos(vertex.y * 4.9 - seed * 0.5) + Math.sin(vertex.z * 5.3 + seed * 1.7);
    vertex.addScaledVector(vertexNormal, (wave / 3) * amount);
    vertex.y *= yScale;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
};

// Stepped horizontal banding to give a tall column the look of stacked
// sedimentary layers (alternating slightly recessed/protruding bands).
const layerColumnGeometry = (geometry, seed = 0) => {
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

export default function Rock({ transforms = [], scatterTransforms = [], material }) {
  const collidableRefs = useRef({});
  const scatterRefs = useRef({});

  const geometryLibrary = useMemo(() => {
    // River-worn: smoother, rounder, more subdivided - reads as a tumbled boulder.
    const boulderRiverworn = displaceGeometry(new THREE.IcosahedronGeometry(1, 2), 0.7, 0.1, 0.92);

    // Angular/fractured: lower-poly, sharper displacement - reads as a freshly
    // cracked rock.
    const boulderAngular = displaceGeometry(new THREE.IcosahedronGeometry(1, 1), 2.4, 0.26, 0.95);

    const slab = displaceGeometry(new THREE.DodecahedronGeometry(1, 0), 1.9, 0.12, 0.42);
    slab.scale(1.45, 0.65, 1.15);
    slab.computeVertexNormals();

    // Fractured column: sharp noise, vertical cracks.
    const columnFractured = new THREE.CylinderGeometry(0.62, 0.82, 3.2, 7, 3);
    displaceGeometry(columnFractured, 3.3, 0.1, 1);
    columnFractured.translate(0, 1.6, 0);
    columnFractured.computeVertexNormals();

    // Layered column: stacked sedimentary bands.
    const columnLayered = new THREE.CylinderGeometry(0.7, 0.9, 3.4, 8, 6);
    layerColumnGeometry(columnLayered, 1.2);
    columnLayered.translate(0, 1.7, 0);
    columnLayered.computeVertexNormals();

    const scree = displaceGeometry(new THREE.IcosahedronGeometry(0.35, 0), 4.2, 0.1, 0.75);

    return { boulderRiverworn, boulderAngular, slab, columnFractured, columnLayered, scree };
  }, []);

  // Per-personality material clones, each with its own RockShader injection
  // (moss/lichen, iron-oxide streaks, sedimentary banding, dust, wetness, rim).
  const materialLibrary = useMemo(() => {
    const library = {};
    Object.entries(VARIANT_SHADER_OPTIONS).forEach(([variant, options]) => {
      const clone = material ? material.clone() : new THREE.MeshStandardMaterial({ color: '#888', roughness: 0.9 });
      extendRockMaterial(clone, options);
      library[variant] = clone;
    });
    return library;
  }, [material]);

  const collidableGroups = useMemo(() => {
    const grouped = { boulder: [], slab: [], column: [] };
    transforms.forEach((t, i) => {
      const rockType = grouped[t.rockType] ? t.rockType : 'boulder';
      grouped[rockType].push({ key: `rock-${rockType}-${i}`, ...t });
    });

    const byVariant = {};
    Object.entries(grouped).forEach(([rockType, instances]) => {
      const variants = VARIANTS_BY_TYPE[rockType];
      instances.forEach((instance, i) => {
        const variant = variants[i % variants.length];
        if (!byVariant[variant]) byVariant[variant] = [];
        byVariant[variant].push(instance);
      });
    });
    return byVariant;
  }, [transforms]);

  const scatterGroups = useMemo(() => {
    const grouped = { boulder: [], slab: [], column: [] };
    scatterTransforms.forEach((t, i) => {
      const rockType = grouped[t.rockType] ? t.rockType : 'boulder';
      grouped[rockType].push({ key: `scatter-${rockType}-${i}`, ...t });
    });

    const byVariant = {};
    Object.entries(grouped).forEach(([rockType, instances]) => {
      const variants = SCATTER_VARIANTS_BY_TYPE[rockType];
      instances.forEach((instance, i) => {
        const variant = variants[i % variants.length];
        if (!byVariant[variant]) byVariant[variant] = [];
        byVariant[variant].push(instance);
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
      {Object.entries(collidableGroups).map(([variant, instances]) => {
        if (!instances.length) return null;
        const geometryKey = variant === 'columnFractured' || variant === 'columnLayered'
          ? variant
          : variant === 'slab' ? 'slab'
          : variant;

        return (
          <InstancedRigidBodies
            key={`rigid-${variant}`}
            instances={instances}
            type="fixed"
            colliders={variant === 'slab' ? 'cuboid' : 'hull'}
          >
            <instancedMesh
              ref={(node) => {
                if (node) collidableRefs.current[variant] = node;
                else delete collidableRefs.current[variant];
              }}
              args={[geometryLibrary[geometryKey], materialLibrary[variant], instances.length]}
              castShadow
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
            args={[geometryLibrary[variant], materialLibrary[variant], instances.length]}
            castShadow
            receiveShadow
          />
        );
      })}
    </group>
  );
}
