import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { reflectionTargetSize } from './WaterReflection';

describe('reflectionTargetSize', () => {
  const out = new THREE.Vector2();

  it('renders at half the drawing buffer, keeping its aspect', () => {
    expect(reflectionTargetSize(1280, 720, 1024, out).toArray()).toEqual([640, 360]);
  });

  it('caps the long edge at the LOD budget', () => {
    expect(reflectionTargetSize(2560, 1440, 512, out).toArray()).toEqual([512, 288]);
  });

  it('never sizes a target to zero', () => {
    expect(reflectionTargetSize(0, 0, 512, out).toArray()).toEqual([1, 1]);
  });
});
