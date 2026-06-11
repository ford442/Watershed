import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { mergeBufferGeometries } from 'three-stdlib';
import { extendVegetationMaterial, updateVegetationMaterial } from '../../utils/VegetationShader';

const STALK_GREEN = new THREE.Color('#3f6b34');
const STALK_TIP = new THREE.Color('#7da84a');
const CATTAIL_BODY = new THREE.Color('#5a3a22');
const CATTAIL_TIP = new THREE.Color('#2e1d11');
const BROKEN_TIP = new THREE.Color('#8a7250');

const PLANT_HEIGHT = 2.0;

const paintGradient = (geo, fromColor, toColor, minY, maxY) => {
    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const span = Math.max(0.0001, maxY - minY);
    const c = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
        const t = THREE.MathUtils.clamp((positions.getY(i) - minY) / span, 0, 1);
        c.copy(fromColor).lerp(toColor, t);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
};

const mergeCompatibleGeometries = (geometries) => {
    if (!geometries.length) return new THREE.BufferGeometry();
    const normalized = geometries.map((g) => g.index ? g.toNonIndexed() : g);
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

export default function Reeds({ transforms }) {
  // Geometry: Cluster of cattails with a couple of weather-broken stalks for character
  const geometry = useMemo(() => {
    try {
        const geos = [];
        const count = 5; // Reeds per clump

        for (let i = 0; i < count; i++) {
            const offsetX = (Math.random() - 0.5) * 0.6;
            const offsetZ = (Math.random() - 0.5) * 0.6;
            const tiltX = (Math.random() - 0.5) * 0.2;
            const tiltZ = (Math.random() - 0.5) * 0.2;
            const isBroken = Math.random() < 0.15;

            if (isBroken) {
                // Broken/snapped stalk - short, jaggedly tilted, frayed tip, no cattail head
                const height = 0.45 + Math.random() * 0.35;
                const stalkGeo = new THREE.CylinderGeometry(0.018, 0.022, height, 4);
                stalkGeo.translate(0, height / 2, 0);
                stalkGeo.rotateX(tiltX * 2.2 + 0.35);
                stalkGeo.rotateZ(tiltZ * 2.2);
                paintGradient(stalkGeo, STALK_GREEN, BROKEN_TIP, 0, height);
                stalkGeo.translate(offsetX, 0, offsetZ);
                geos.push(stalkGeo);
                continue;
            }

            const height = 1.2 + Math.random() * 0.8;

            // Stalk
            const stalkRadius = 0.02;
            const stalkGeo = new THREE.CylinderGeometry(stalkRadius, stalkRadius, height, 4);
            stalkGeo.translate(0, height / 2, 0); // Base at 0
            paintGradient(stalkGeo, STALK_GREEN, STALK_TIP, 0, height);
            stalkGeo.rotateX(tiltX);
            stalkGeo.rotateZ(tiltZ);
            stalkGeo.translate(offsetX, 0, offsetZ);
            geos.push(stalkGeo);

            // Cattail head - two-part silhouette: plump cylindrical body + tapered velvet tip
            if (Math.random() > 0.4) {
                const bodyHeight = 0.32;
                const bodyRadius = 0.065;
                const bodyGeo = new THREE.CylinderGeometry(bodyRadius * 0.85, bodyRadius, bodyHeight, 6);
                const bodyY = height - 0.12;
                bodyGeo.translate(0, bodyY, 0);
                paintGradient(bodyGeo, CATTAIL_BODY, CATTAIL_TIP, bodyY - bodyHeight / 2, bodyY + bodyHeight / 2);

                const tipHeight = 0.12;
                const tipGeo = new THREE.ConeGeometry(bodyRadius * 0.85, tipHeight, 6);
                const tipY = bodyY + bodyHeight / 2 + tipHeight / 2;
                tipGeo.translate(0, tipY, 0);
                paintGradient(tipGeo, CATTAIL_TIP, CATTAIL_TIP, tipY - tipHeight / 2, tipY + tipHeight / 2);

                [bodyGeo, tipGeo].forEach((g) => {
                    g.rotateX(tiltX);
                    g.rotateZ(tiltZ);
                    g.translate(offsetX, 0, offsetZ);
                    geos.push(g);
                });
            }
        }

        if (geos.length === 0) return new THREE.BufferGeometry();

        const merged = mergeCompatibleGeometries(geos);
        if (!merged) return new THREE.BufferGeometry();

        merged.computeVertexNormals();
        return merged;
    } catch (e) {
        console.error("Error creating Reeds geometry:", e);
        return new THREE.BoxGeometry(0.1, 1, 0.1); // Fallback
    }
  }, []);

  // Material: vertex-colored stalks/cattails, individually wind-animated
  const reedsMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
        vertexColors: true,
    });
    extendVegetationMaterial(mat, { plantHeight: PLANT_HEIGHT, windStrength: 0.09, windSpeed: 1.1 });
    return mat;
  }, []);

  useFrame((state) => {
    updateVegetationMaterial(reedsMaterial, state.clock.elapsedTime);
  });

  const instances = useMemo(() => {
      if (!transforms) return [];
      return transforms.map((t, i) => {
          const isDry = Math.random() > 0.7;
          const shade = (isDry ? 0.75 : 0.9) + Math.random() * 0.3;

          return {
              key: `reeds-${i}`,
              position: t.position,
              rotation: t.rotation,
              scale: t.scale,
              color: new THREE.Color(0xffffff).multiplyScalar(shade),
          };
      });
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
      <Instances range={instances.length} geometry={geometry} material={reedsMaterial} castShadow receiveShadow>
          {instances.map((data) => (
              <Instance
                  key={data.key}
                  position={data.position}
                  rotation={data.rotation}
                  scale={data.scale}
                  color={data.color}
              />
          ))}
      </Instances>
  );
}
