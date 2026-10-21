/**
 * meshMath — each port is bit-identical to the three.js it replaces, so a
 * segment built in the sim worker (no three) equals one built with three.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CatmullRomPath,
  computeVertexNormals,
  copyRgb,
  lerpRgb,
  planeGrid,
  rgb,
  scaleRgb,
  type CurveType,
} from '../meshMath';
import { clamp, smoothstep } from '../../math/scalar';

/** Deterministic LCG. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Index of the first element that is not Object.is-equal (−1: identical). toEqual is too slow at 66k vertices. */
function firstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

describe('meshMath vs three', () => {
  it('rgb / copy / lerp / scale match THREE.Color in the linear working space', () => {
    const r = rng(1);
    for (let i = 0; i < 200; i += 1) {
      const hexA = `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`;
      const hexB = `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`;
      const alpha = r();
      const s = 0.5 + r();
      const three = new THREE.Color().copy(new THREE.Color(hexA)).lerp(new THREE.Color(hexB), alpha).multiplyScalar(s);
      const ours = scaleRgb(lerpRgb(copyRgb({ r: 0, g: 0, b: 0 }, rgb(hexA)), rgb(hexB), alpha), s);
      expect([ours.r, ours.g, ours.b], `${hexA} ${hexB}`).toEqual([three.r, three.g, three.b]);
    }
    expect(() => rgb('#abc')).toThrow();
  });

  it('clamp / smoothstep match MathUtils', () => {
    const r = rng(2);
    for (let i = 0; i < 500; i += 1) {
      const x = r() * 40 - 20;
      expect(clamp(x, -1, 3)).toBe(THREE.MathUtils.clamp(x, -1, 3));
      expect(smoothstep(x, -2, 6)).toBe(THREE.MathUtils.smoothstep(x, -2, 6));
    }
  });

  it.each(['catmullrom', 'centripetal', 'chordal'] as CurveType[])('CatmullRomPath matches CatmullRomCurve3 (%s)', (curveType) => {
    const r = rng(curveType.length);
    for (let c = 0; c < 20; c += 1) {
      const n = 2 + Math.floor(r() * 6);
      const pts = Array.from({ length: n }, (_, i) => new THREE.Vector3(r() * 20 - 10, -i * 3 * r(), -i * 30 - r() * 5));
      // Repeated points exercise the dt safety branches.
      if (c === 3) pts[1].copy(pts[0]);
      const closed = c % 5 === 4;
      const tension = 0.1 + r() * 0.8;
      const three = new THREE.CatmullRomCurve3(pts, closed, curveType, tension);
      const ours = new CatmullRomPath(pts.map((p) => ({ x: p.x, y: p.y, z: p.z })), closed, curveType, tension);
      for (const t of [0, 1, 0.5, ...Array.from({ length: 30 }, () => r())]) {
        const a = three.getPoint(t);
        const b = ours.getPoint(t);
        expect([b.x, b.y, b.z], `t=${t}`).toEqual([a.x, a.y, a.z]);
      }
      expect(ours.getLength()).toBe(three.getLength());
    }
  });

  it.each([
    [35, 96.37, 40, 96],
    [24, 110.2, 10, 27],
    [20.3, 45.1, 8, 22],
    [52.5, 96, 24, 48],
    // > 65535 vertices: Uint32 index.
    [10, 300, 256, 256],
  ])('planeGrid matches PlaneGeometry(%d, %d, %d, %d).rotateX(−π/2)', { timeout: 30000 }, (w, h, sx, sz) => {
    const geo = new THREE.PlaneGeometry(w, h, sx, sz);
    geo.rotateX(-Math.PI / 2);
    const grid = planeGrid(w, h, sx, sz);
    expect(grid.count).toBe(geo.attributes.position.count);
    expect(firstDifference(grid.positions, geo.attributes.position.array)).toBe(-1);
    expect(firstDifference(grid.uvs, geo.attributes.uv.array)).toBe(-1);
    expect(grid.index.constructor).toBe(geo.index!.array.constructor);
    expect(firstDifference(grid.index, geo.index!.array)).toBe(-1);
    // Normals only survive a NaN path (every finite build recomputes them): close is enough.
    const normals = geo.attributes.normal.array as Float32Array;
    for (let i = 0; i < normals.length; i += 1) expect(Math.abs(grid.normals[i] - normals[i])).toBeLessThan(1e-6);
  });

  it('computeVertexNormals matches BufferGeometry.computeVertexNormals', () => {
    const r = rng(9);
    const geo = new THREE.PlaneGeometry(30, 80, 12, 40);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) pos.setY(i, Math.sin(pos.getX(i) * 0.3) * 4 + r() * 2);
    const positions = (pos.array as Float32Array).slice();
    geo.computeVertexNormals();
    const normals = new Float32Array(positions.length).fill(7);
    computeVertexNormals(positions, geo.index!.array as Uint16Array, normals);
    expect(normals).toEqual(geo.attributes.normal.array);
  });
});
