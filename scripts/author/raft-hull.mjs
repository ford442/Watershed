#!/usr/bin/env node
/**
 * author/raft-hull — writes the authored SOURCE for the default raft hull (#536 A.3):
 *
 *   node scripts/author/raft-hull.mjs   →   assets/src/core/raft.hull.default.glb
 *
 * This is an authoring tool, not a build step. Its output is committed as the source the
 * asset pipeline (scripts/build-assets.mjs) compresses into public/assets/core/; a hull
 * exported from Blender (or any DCC) can replace that .glb with no code change, as long as
 * it keeps the conventions below. Re-run only when you mean to re-author the hull.
 *
 * Conventions every raft hull source keeps (the game relies on them, the collider does not):
 *   - metres, +Y up, bow toward −Z (the raft's forward), origin at the hull's centre of
 *     volume, so it overlays the physics box (RAFT.WIDTH × RAFT.HEIGHT × RAFT.LENGTH in
 *     src/constants/game.ts: 2 × 0.3 × 3 m) without an offset;
 *   - one mesh, one material, colour in COLOR_0 (the wet-hull tint multiplies the material
 *     colour, so a single white-based material darkens every part together);
 *   - the visual mesh never feeds physics: RaftVehicle declares its colliders explicitly.
 *
 * The hull: seven peeled logs lashed to two squared cross-beams, a three-plank seat deck,
 * rope wraps at every beam crossing. Irregularity (log radius, length, sag, bark tone) comes
 * from a fixed-seed PRNG, so re-running the script reproduces the same bytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outFile = path.join(rootDir, 'assets', 'src', 'core', 'raft.hull.default.glb');

// Physics box the hull dresses (src/constants/game.ts RAFT). Kept literal: this script is
// node tooling and must not import the TS tree.
const WIDTH = 2;
const HEIGHT = 0.3;
const LENGTH = 3;

/** mulberry32 — fixed seed, so the source is reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x5eed_4a57);
const jitter = (amount) => (rand() * 2 - 1) * amount;

/** Paint a geometry one colour (COLOR_0), optionally a second colour where `pick` says so. */
function paint(geometry, color, alt, pick) {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const c = alt && pick(pos, nrm, i) ? alt : color;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Keep only position / normal / color, so every part merges into one attribute layout. */
function clean(geometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') geometry.deleteAttribute(name);
  }
  return geometry;
}

const parts = [];

// --- Logs: seven along Z, sitting so their tops are the deck line --------------------
const LOGS = 7;
const logRadius = WIDTH / LOGS / 2; // ≈ 0.143 m: seven logs fill the 2 m beam
const bark = new THREE.Color('#6b4a2f');
const endGrain = new THREE.Color('#c79f6c');
for (let i = 0; i < LOGS; i += 1) {
  const r = logRadius * (0.92 + rand() * 0.1);
  const len = LENGTH * (0.94 + rand() * 0.06);
  const geo = new THREE.CylinderGeometry(r * 0.96, r, len, 12, 6, false);
  // Bow taper and a little sag, so the logs read as timber, not pipes.
  const pos = geo.getAttribute('position');
  const sag = jitter(0.012);
  for (let v = 0; v < pos.count; v += 1) {
    const along = pos.getY(v) / (len / 2); // −1 (stern) … +1 (bow, before the rotation)
    const taper = along > 0.75 ? 1 - (along - 0.75) * 0.6 : 1;
    pos.setX(v, pos.getX(v) * taper);
    pos.setZ(v, pos.getZ(v) * taper + sag * (1 - along * along));
  }
  geo.computeVertexNormals();
  const tone = bark.clone().offsetHSL(jitter(0.015), jitter(0.05), jitter(0.05));
  // Cap vertices (normals along the log axis) take the end-grain colour.
  paint(geo, tone, endGrain, (_p, n, v) => Math.abs(n.getY(v)) > 0.7);
  // Cylinder axis is Y; lay it along Z with the +Y end as the bow (−Z).
  geo.rotateX(-Math.PI / 2);
  const x = -WIDTH / 2 + logRadius + i * logRadius * 2;
  geo.translate(x + jitter(0.01), jitter(0.01), jitter(0.04));
  parts.push(clean(geo));
}

// --- Cross-beams: two squared timbers across X, notched onto the logs ----------------
const beamColor = new THREE.Color('#4e3420');
const beamZ = [-LENGTH * 0.32, LENGTH * 0.32];
const beamTop = HEIGHT / 2 + 0.07;
for (const z of beamZ) {
  const geo = new THREE.BoxGeometry(WIDTH * 1.06, 0.1, 0.16);
  geo.translate(0, beamTop - 0.05, z + jitter(0.02));
  paint(geo, beamColor.clone().offsetHSL(0, 0, jitter(0.03)));
  parts.push(clean(geo));
}

// --- Seat deck: three planks across the beams amidships ------------------------------
const plank = new THREE.Color('#8a6a45');
for (let i = 0; i < 3; i += 1) {
  const geo = new THREE.BoxGeometry(0.22, 0.035, beamZ[1] - beamZ[0] + 0.3);
  geo.translate(-0.26 + i * 0.26 + jitter(0.01), beamTop + 0.0175, jitter(0.02));
  paint(geo, plank.clone().offsetHSL(0, jitter(0.04), jitter(0.05)));
  parts.push(clean(geo));
}

// --- Lashings: a rope wrap where each beam crosses each log ---------------------------
const rope = new THREE.Color('#b59a68');
for (const z of beamZ) {
  for (let i = 0; i < LOGS; i += 1) {
    const geo = new THREE.TorusGeometry(logRadius * 0.95, 0.018, 4, 10);
    // Torus lies in XY; stand it across the log axis (Z) and lift it to wrap the beam too.
    geo.scale(1, 1.25, 1);
    const x = -WIDTH / 2 + logRadius + i * logRadius * 2;
    geo.translate(x, 0.03, z + 0.1);
    paint(geo, rope.clone().offsetHSL(0, 0, jitter(0.04)));
    parts.push(clean(geo));
  }
}

const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
if (!merged) throw new Error('raft-hull: merge failed');

// --- Write the source .glb ------------------------------------------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const f32 = (attr) => new Float32Array(attr.array);
const accessor = (name, array, type) =>
  doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);

const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', accessor('position', f32(merged.getAttribute('position')), 'VEC3'))
  .setAttribute('NORMAL', accessor('normal', f32(merged.getAttribute('normal')), 'VEC3'))
  .setAttribute('COLOR_0', accessor('color', f32(merged.getAttribute('color')), 'VEC3'))
  .setMaterial(
    doc
      .createMaterial('raft.wood')
      .setBaseColorFactor([1, 1, 1, 1])
      .setRoughnessFactor(0.85)
      .setMetallicFactor(0),
  );
const mesh = doc.createMesh('raft.hull.default').addPrimitive(prim);
const node = doc.createNode('raft.hull.default').setMesh(mesh);
doc.createScene('raft.hull.default').addChild(node);
doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
doc.getRoot().getAsset().generator = 'watershed scripts/author/raft-hull.mjs';

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const bytes = await new NodeIO().writeBinary(doc);
fs.writeFileSync(outFile, bytes);
const tris = merged.getAttribute('position').count / 3;
console.log(`author/raft-hull: ${path.relative(rootDir, outFile)} (${bytes.byteLength} B, ${tris} triangles, unwelded)`);
