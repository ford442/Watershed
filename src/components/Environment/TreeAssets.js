import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';

const TREE_SPECIES = ['conifer', 'broadleaf', 'birch', 'snag'];

const mergeCompatibleGeometries = (geometries) => {
  const normalized = geometries.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry);
  return mergeBufferGeometries(normalized) || new THREE.BufferGeometry();
};

const applyVertexColor = (geometry, color) => {
  const attribute = geometry.getAttribute('position');
  const colors = new Float32Array(attribute.count * 3);
  const swatch = new THREE.Color(color);

  for (let i = 0; i < attribute.count; i++) {
    colors[i * 3] = swatch.r;
    colors[i * 3 + 1] = swatch.g;
    colors[i * 3 + 2] = swatch.b;
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
};

const createBranch = (length, radius, rotationZ, y) => {
  const branch = new THREE.CylinderGeometry(radius * 0.45, radius, length, 5);
  branch.translate(0, length * 0.5, 0);
  branch.rotateZ(rotationZ);
  branch.translate(0, y, 0);
  return branch;
};

export function useTreeAssets() {
  const variants = useMemo(() => {
    const coniferTrunk = applyVertexColor(
      new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6).translate(0, 0.75, 0),
      '#4a3a2e'
    );
    const coniferFoliage = [
      new THREE.ConeGeometry(1.3, 1.8, 7).translate(0, 1.9, 0),
      new THREE.ConeGeometry(1.0, 1.6, 7).translate(0, 3.0, 0),
      new THREE.ConeGeometry(0.7, 1.4, 7).translate(0, 4.0, 0),
    ].map((geo) => applyVertexColor(geo, '#315c27'));

    const broadleafTrunkParts = [
      new THREE.CylinderGeometry(0.16, 0.26, 1.8, 6).translate(0, 0.9, 0),
      createBranch(1.1, 0.1, Math.PI / 5, 1.2),
      createBranch(1.0, 0.09, -Math.PI / 4.5, 1.15),
    ].map((geo) => applyVertexColor(geo, '#5a4132'));
    const broadleafFoliage = [
      new THREE.IcosahedronGeometry(0.95, 1).translate(-0.35, 2.9, 0.15),
      new THREE.IcosahedronGeometry(1.05, 1).translate(0.45, 3.3, -0.05),
      new THREE.IcosahedronGeometry(0.8, 1).translate(0.1, 3.8, 0.35),
    ].map((geo) => applyVertexColor(geo, '#c97428'));

    const birchTrunk = (() => {
      const geo = new THREE.CylinderGeometry(0.09, 0.12, 3.7, 6).translate(0, 1.85, 0);
      const positions = geo.getAttribute('position');
      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        const stripe = Math.sin(y * 7.5) > 0.55 ? 0.15 : 0;
        colors[i * 3] = 0.84 - stripe;
        colors[i * 3 + 1] = 0.83 - stripe;
        colors[i * 3 + 2] = 0.79 - stripe;
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return geo;
    })();
    const birchFoliage = [
      new THREE.SphereGeometry(0.45, 6, 5).translate(-0.25, 4.0, 0),
      new THREE.SphereGeometry(0.52, 6, 5).translate(0.2, 4.4, 0.15),
      new THREE.SphereGeometry(0.4, 6, 5).translate(0.05, 4.85, -0.15),
    ].map((geo) => applyVertexColor(geo, '#87a95d'));

    const snagParts = [
      new THREE.CylinderGeometry(0.12, 0.2, 3.2, 5).translate(0, 1.6, 0),
      createBranch(0.9, 0.08, Math.PI / 3.3, 2.1),
      createBranch(0.7, 0.07, -Math.PI / 3.8, 1.8),
      new THREE.ConeGeometry(0.18, 0.4, 5).rotateZ(Math.PI / 10).translate(0.05, 3.35, 0),
    ].map((geo) => applyVertexColor(geo, '#615246'));

    const speciesVariants = [
      {
        type: 'conifer',
        geometry: mergeCompatibleGeometries([coniferTrunk, ...coniferFoliage]),
        swayAmount: 0.04,
        baseTint: '#ffffff',
      },
      {
        type: 'broadleaf',
        geometry: mergeCompatibleGeometries([...broadleafTrunkParts, ...broadleafFoliage]),
        swayAmount: 0.07,
        baseTint: '#fff0e0',
      },
      {
        type: 'birch',
        geometry: mergeCompatibleGeometries([birchTrunk, ...birchFoliage]),
        swayAmount: 0.05,
        baseTint: '#f3f6ea',
      },
      {
        type: 'snag',
        geometry: mergeCompatibleGeometries(snagParts),
        swayAmount: 0.01,
        baseTint: '#f3e7d6',
      },
    ];

    speciesVariants.forEach((variant) => {
      variant.geometry.computeVertexNormals();
    });

    return speciesVariants;
  }, []);

  return { variants, species: TREE_SPECIES };
}
