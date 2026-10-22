import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyLookDelta } from './InputLookApply';

describe('applyLookDelta', () => {
  it('uses PointerLockControls maths: 0.002 rad/px, right turns right, down looks down', () => {
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    applyLookDelta(e, 100, 50, 1, false);
    expect(e.y).toBeCloseTo(-0.2);
    expect(e.x).toBeCloseTo(-0.1);
  });

  it('scales by sensitivity and flips pitch with invert-Y', () => {
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    applyLookDelta(e, 0, 100, 2, true);
    expect(e.x).toBeCloseTo(0.4);
  });

  it('clamps pitch short of straight up / down', () => {
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    applyLookDelta(e, 0, 1e6, 1, false);
    expect(e.x).toBeGreaterThan(-Math.PI / 2);
    applyLookDelta(e, 0, -1e7, 1, false);
    expect(e.x).toBeLessThan(Math.PI / 2);
  });
});
