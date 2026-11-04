/**
 * The path lateral has one definition (#546 B). These pin its sign and its bits against
 * the `crossVectors(tangent, up).normalize()` form the replaced sites used, and keep new
 * hand-rolled copies out of src/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  createPathFrame,
  createSegmentFlowSample,
  pathLateral,
  pathLateralOrX,
  sampleFrameAt,
  sampleSegmentFlow,
} from './segmentSampler';

const UP = new THREE.Vector3(0, 1, 0);
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, -6, -10),
  new THREE.Vector3(8, -9, -50),
  new THREE.Vector3(-12, -14, -95),
  new THREE.Vector3(3, -20, -140),
]);

describe('pathLateral', () => {
  it('is tangent × up, normalised, bit for bit', () => {
    for (let i = 0; i <= 40; i += 1) {
      const t = i / 40;
      const tangent = curve.getTangent(t).normalize();
      const expected = new THREE.Vector3().crossVectors(tangent, UP).normalize();
      const got = pathLateral(tangent, new THREE.Vector3());
      expect(got.x).toBe(expected.x);
      expect(got.z).toBe(expected.z);
      expect(got.y === 0 && expected.y === 0).toBe(true); // ±0 both
    }
  });

  it('points to the right of travel: heading -Z, the lateral is +X', () => {
    const close = (v: THREE.Vector3, x: number, y: number, z: number) => {
      expect(v.x).toBeCloseTo(x, 12);
      expect(v.y).toBeCloseTo(y, 12);
      expect(v.z).toBeCloseTo(z, 12);
    };
    close(pathLateral(new THREE.Vector3(0, 0, -1), new THREE.Vector3()), 1, 0, 0);
    close(pathLateral(new THREE.Vector3(1, 0, 0), new THREE.Vector3()), 0, 0, 1);
  });

  it('is zero for a vertical tangent; pathLateralOrX picks +X', () => {
    expect(pathLateral(new THREE.Vector3(0, 1, 0), new THREE.Vector3()).lengthSq()).toBe(0);
    expect(pathLateralOrX(new THREE.Vector3(0, -1, 0), new THREE.Vector3()).toArray()).toEqual([1, 0, 0]);
  });
});

describe('sampleFrameAt', () => {
  it('writes point / unit tangent / lateral into the frame it is given', () => {
    const frame = createPathFrame();
    const { point, tangent, lateral } = frame;
    expect(sampleFrameAt(curve, 0.4, frame)).toBe(frame);
    expect(frame.point).toBe(point);
    expect(frame.tangent).toBe(tangent);
    expect(frame.lateral).toBe(lateral);
    expect(point.equals(curve.getPoint(0.4))).toBe(true);
    expect(tangent.length()).toBeCloseTo(1, 12);
    expect(lateral.equals(pathLateral(tangent, new THREE.Vector3()))).toBe(true);
    expect(lateral.dot(tangent)).toBeCloseTo(0, 12);
  });

  it('agrees on sign with the flow sampler (the rainbow, the props, the forces all read one side)', () => {
    const sample = createSegmentFlowSample();
    const frame = createPathFrame();
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      sampleFrameAt(curve, t, frame);
      const hit = sampleSegmentFlow({ segmentPath: curve }, frame.point, sample);
      expect(hit).not.toBeNull();
      expect(sample.lateral.dot(frame.lateral)).toBeCloseTo(1, 9);
    }
  });
});

describe('no hand-rolled path lateral in src/', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.resolve(here, '..');
  const HAND_ROLLED = [
    /new THREE\.Vector3\(\s*-?[\w.]+\.z,\s*0,\s*-?[\w.]+\.x\s*\)/,
    /crossVectors\(\s*[\w.]+,\s*(?:new THREE\.Vector3\(0,\s*1,\s*0\)|\w*UP\w*|up|_up)\s*\)/,
  ];
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it('finds none outside segmentSampler.ts', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      if (file.endsWith(path.join('utils', 'segmentSampler.ts'))) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (HAND_ROLLED.some((re) => re.test(line))) offenders.push(`${path.relative(srcDir, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
