import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';

const TREE_SPECIES = ['conifer', 'broadleaf', 'birch', 'snag'];

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

// Adds vertical ridge displacement to trunk/branch cylinders for a barky silhouette.
const addBarkRidges = (geometry, amplitude = 0.035, ridges = 8) => {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    if (r < 1e-5) continue;
    const angle = Math.atan2(z, x);
    const ridge = Math.sin(angle * ridges + y * 2.5) * amplitude;
    const scale = (r + ridge) / r;
    pos.setXYZ(i, x * scale, y, z * scale);
  }
  pos.needsUpdate = true;
  return geometry;
};

// Bakes per-vertex wind sway strength + a foliage mask used by TreeShader.
const addWindAndFoliageAttrs = (geometry, { isFoliage = false, windBase = 0, windHeightScale = 0.05 } = {}) => {
  const pos = geometry.getAttribute('position');
  const wind = new Float32Array(pos.count);
  const foliage = new Float32Array(pos.count).fill(isFoliage ? 1 : 0);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    wind[i] = windBase + Math.max(0, y) * windHeightScale;
  }
  geometry.setAttribute('windFactor', new THREE.Float32BufferAttribute(wind, 1));
  geometry.setAttribute('isFoliage', new THREE.Float32BufferAttribute(foliage, 1));
  return geometry;
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

// Deterministic pseudo-random generator (mulberry32) for repeatable scatter patterns.
const seededRandom = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Adds a per-vertex isFoliageCard mask + per-card leafSeed + cardUv (copy of uv),
// used by TreeShader to flutter and carve a leaf/needle silhouette out of a quad.
const markAsLeafCard = (geometry, seed) => {
  const uv = geometry.getAttribute('uv');
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('cardUv', new THREE.BufferAttribute(uv ? uv.array.slice() : new Float32Array(count * 2), 2));
  geometry.setAttribute('isFoliageCard', new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.setAttribute('leafSeed', new THREE.Float32BufferAttribute(new Float32Array(count).fill(seed), 1));
  return geometry;
};

// Small alpha-carved leaf/needle card: a plane positioned/rotated within the canopy,
// flagged for per-card flutter and silhouette discard via TreeShader.
const createLeafCard = ({ width, height, position, rotation = [0, 0, 0], seed, color, windBase, windHeightScale }) => {
  const geo = new THREE.PlaneGeometry(width, height, 1, 1);
  geo.rotateX(rotation[0]);
  geo.rotateY(rotation[1]);
  geo.rotateZ(rotation[2]);
  geo.translate(position[0], position[1], position[2]);
  applyVertexColor(geo, color);
  addWindAndFoliageAttrs(geo, { isFoliage: true, windBase, windHeightScale });
  markAsLeafCard(geo, seed);
  return geo;
};

// Scatters leaf/needle cards around a set of canopy cluster centers.
const scatterLeafCards = ({ centers, count, sizeRange, color, windBase, windHeightScale, seed, spread = 0.6, elongated = false }) => {
  const rand = seededRandom(seed);
  const cards = [];
  for (let i = 0; i < count; i++) {
    const center = centers[i % centers.length];
    const px = center[0] + (rand() - 0.5) * spread;
    const py = center[1] + (rand() - 0.5) * spread * 0.8;
    const pz = center[2] + (rand() - 0.5) * spread;
    const size = sizeRange[0] + rand() * (sizeRange[1] - sizeRange[0]);
    const width = elongated ? size * 0.35 : size;
    const height = elongated ? size : size * 1.15;
    const rotation = [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI];
    cards.push(createLeafCard({
      width, height,
      position: [px, py, pz],
      rotation,
      seed: rand(),
      color,
      windBase,
      windHeightScale,
    }));
  }
  return cards;
};

// Hangs a thin drooping vine from an attachment point; sway increases toward the tip.
const createVine = (attachPoint, length, seed) => {
  const rand = seededRandom(seed);
  const lean = (rand() - 0.5) * 0.5;
  const geo = new THREE.CylinderGeometry(0.012, 0.035, length, 4, 3)
    .translate(0, -length / 2, 0)
    .translate(attachPoint[0], attachPoint[1], attachPoint[2]);

  // Lean the vine outward slightly along its length for a draped look
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const dropFactor = (attachPoint[1] - y) / length;
    pos.setX(i, pos.getX(i) + lean * dropFactor * dropFactor);
  }
  pos.needsUpdate = true;

  applyVertexColor(geo, '#5a6e3a');

  // Sway grows the further the vertex hangs below the attachment point.
  const wind = new Float32Array(pos.count);
  const foliage = new Float32Array(pos.count).fill(1);
  for (let i = 0; i < pos.count; i++) {
    const dropFactor = Math.max(0, (attachPoint[1] - pos.getY(i)) / length);
    wind[i] = 0.05 + dropFactor * dropFactor * 0.35;
  }
  geo.setAttribute('windFactor', new THREE.Float32BufferAttribute(wind, 1));
  geo.setAttribute('isFoliage', new THREE.Float32BufferAttribute(foliage, 1));
  return geo;
};

// Bracket-fungus shelf jutting from a trunk: stark, rigid, gives dead trees character.
const createFungusShelf = (height, angle, size = 0.16) => {
  const geo = new THREE.CircleGeometry(size, 6, 0, Math.PI);
  geo.rotateX(-Math.PI / 2 + 0.15);
  geo.rotateY(angle);
  const radialOffset = 0.18;
  geo.translate(Math.cos(angle) * radialOffset, height, Math.sin(angle) * radialOffset);
  applyVertexColor(geo, '#cdbf9a');
  return addWindAndFoliageAttrs(geo, { isFoliage: false, windBase: 0, windHeightScale: 0 });
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
    const coniferTrunk = addWindAndFoliageAttrs(
      addBarkRidges(applyVertexColor(
        new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6).translate(0, 0.75, 0),
        '#4a3a2e'
      )),
      { isFoliage: false, windBase: 0.005, windHeightScale: 0.02 }
    );
    const coniferFoliage = [
      new THREE.ConeGeometry(1.4, 1.6, 7).translate(0, 1.6, 0),
      new THREE.ConeGeometry(1.15, 1.6, 7).translate(0, 2.6, 0),
      new THREE.ConeGeometry(0.85, 1.5, 7).translate(0, 3.6, 0),
      new THREE.ConeGeometry(0.55, 1.3, 7).translate(0, 4.6, 0),
    ].map((geo) => addWindAndFoliageAttrs(
      applyVertexColor(geo, '#315c27'),
      { isFoliage: true, windBase: 0.08, windHeightScale: 0.04 }
    ));
    // Needle cards break up the cone silhouette and flutter individually
    const coniferNeedles = scatterLeafCards({
      centers: [[0, 1.8, 0], [0, 2.8, 0], [0, 3.8, 0], [0, 4.6, 0]],
      count: 10,
      sizeRange: [0.5, 0.85],
      color: '#274a1f',
      windBase: 0.12,
      windHeightScale: 0.045,
      seed: 1001,
      spread: 1.4,
      elongated: true,
    });

    const broadleafTrunkParts = [
      new THREE.CylinderGeometry(0.16, 0.26, 1.8, 6).translate(0, 0.9, 0),
      createBranch(1.1, 0.1, Math.PI / 5, 1.2),
      createBranch(1.0, 0.09, -Math.PI / 4.5, 1.15),
    ].map((geo) => addWindAndFoliageAttrs(
      addBarkRidges(applyVertexColor(geo, '#5a4132')),
      { isFoliage: false, windBase: 0.01, windHeightScale: 0.015 }
    ));
    const broadleafCanopyCenters = [
      [-0.35, 2.9, 0.15],
      [0.45, 3.3, -0.05],
      [0.1, 3.8, 0.35],
      [-0.55, 3.55, -0.4],
    ];
    const broadleafFoliage = [
      new THREE.IcosahedronGeometry(0.95, 1).translate(...broadleafCanopyCenters[0]),
      new THREE.IcosahedronGeometry(1.05, 1).translate(...broadleafCanopyCenters[1]),
      new THREE.IcosahedronGeometry(0.8, 1).translate(...broadleafCanopyCenters[2]),
      new THREE.IcosahedronGeometry(0.6, 1).translate(...broadleafCanopyCenters[3]),
    ].map((geo) => addWindAndFoliageAttrs(
      applyVertexColor(geo, '#c97428'),
      { isFoliage: true, windBase: 0.1, windHeightScale: 0.03 }
    ));
    // Individual leaf cards scattered through the canopy for separation + flutter
    const broadleafLeaves = scatterLeafCards({
      centers: broadleafCanopyCenters,
      count: 14,
      sizeRange: [0.4, 0.7],
      color: '#d8852e',
      windBase: 0.16,
      windHeightScale: 0.03,
      seed: 2002,
      spread: 1.0,
    });
    // Hanging vines drape from the canopy underside
    const broadleafVines = [
      createVine([-0.2, 2.6, 0.2], 1.3, 3001),
      createVine([0.5, 2.9, -0.1], 1.6, 3002),
      createVine([0.0, 2.4, -0.35], 1.1, 3003),
    ];

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
      addBarkRidges(geo, 0.015, 10);
      addWindAndFoliageAttrs(geo, { isFoliage: false, windBase: 0.01, windHeightScale: 0.012 });
      return geo;
    })();
    const birchCanopyCenters = [
      [-0.25, 4.0, 0],
      [0.2, 4.4, 0.15],
      [0.05, 4.85, -0.15],
      [-0.45, 4.6, -0.25],
    ];
    const birchFoliage = [
      new THREE.SphereGeometry(0.45, 6, 5).translate(...birchCanopyCenters[0]),
      new THREE.SphereGeometry(0.52, 6, 5).translate(...birchCanopyCenters[1]),
      new THREE.SphereGeometry(0.4, 6, 5).translate(...birchCanopyCenters[2]),
      new THREE.SphereGeometry(0.32, 6, 5).translate(...birchCanopyCenters[3]),
    ].map((geo) => addWindAndFoliageAttrs(
      applyVertexColor(geo, '#87a95d'),
      { isFoliage: true, windBase: 0.12, windHeightScale: 0.02 }
    ));
    // Dappled individual leaves for the lighter, fluttery birch canopy
    const birchLeaves = scatterLeafCards({
      centers: birchCanopyCenters,
      count: 12,
      sizeRange: [0.25, 0.45],
      color: '#a8c97a',
      windBase: 0.2,
      windHeightScale: 0.02,
      seed: 4004,
      spread: 0.9,
    });

    const snagParts = [
      new THREE.CylinderGeometry(0.12, 0.2, 3.2, 5).translate(0, 1.6, 0),
      createBranch(0.9, 0.08, Math.PI / 3.3, 2.1),
      createBranch(0.7, 0.07, -Math.PI / 3.8, 1.8),
      new THREE.ConeGeometry(0.18, 0.4, 5).rotateZ(Math.PI / 10).translate(0.05, 3.35, 0),
    ].map((geo) => addWindAndFoliageAttrs(
      addBarkRidges(applyVertexColor(geo, '#615246'), 0.04, 6),
      { isFoliage: false, windBase: 0.005, windHeightScale: 0.01 }
    ));
    // Bracket fungus shelves give dead trees their own stark graphical interest
    const snagFungus = [
      createFungusShelf(1.0, 0.6, 0.16),
      createFungusShelf(1.65, 2.4, 0.13),
      createFungusShelf(2.2, -1.1, 0.18),
    ];

    const speciesVariants = [
      {
        type: 'conifer',
        geometry: mergeCompatibleGeometries([coniferTrunk, ...coniferFoliage, ...coniferNeedles]),
        swayAmount: 0.04,
        baseTint: '#ffffff',
      },
      {
        type: 'broadleaf',
        geometry: mergeCompatibleGeometries([...broadleafTrunkParts, ...broadleafFoliage, ...broadleafLeaves, ...broadleafVines]),
        swayAmount: 0.07,
        baseTint: '#fff0e0',
      },
      {
        type: 'birch',
        geometry: mergeCompatibleGeometries([birchTrunk, ...birchFoliage, ...birchLeaves]),
        swayAmount: 0.05,
        baseTint: '#f3f6ea',
      },
      {
        type: 'snag',
        geometry: mergeCompatibleGeometries([...snagParts, ...snagFungus]),
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
