import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { frustumReachesBelow, mirroredReflectionU, updateMirrorCamera } from './planarMirror';

function camera(position: [number, number, number], lookAt: [number, number, number]) {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  cam.position.set(...position);
  cam.lookAt(...lookAt);
  cam.updateMatrixWorld();
  return cam;
}

function ndc(cam: THREE.PerspectiveCamera, point: THREE.Vector3, projection = cam.projectionMatrix) {
  const v = new THREE.Vector4(point.x, point.y, point.z, 1)
    .applyMatrix4(cam.matrixWorldInverse)
    .applyMatrix4(projection);
  return new THREE.Vector3(v.x / v.w, v.y / v.w, v.z / v.w);
}

// A riverbank on segment 5: the centreline (and its sheet) sits far below Y 0.5.
const DATUM = -137.25;

describe('updateMirrorCamera', () => {
  const main = camera([4, DATUM + 6, -820], [10, DATUM - 2, -870]);
  const virtual = new THREE.PerspectiveCamera();
  const rendered = updateMirrorCamera(main, virtual, DATUM);

  it('renders only while the camera is above the local water datum', () => {
    expect(rendered).toBe(true);
    const below = camera([0, DATUM - 1, 0], [0, DATUM - 1, -10]);
    expect(updateMirrorCamera(below, new THREE.PerspectiveCamera(), DATUM)).toBe(false);
  });

  it('mirrors through the datum, not a fixed Y 0.5', () => {
    const p = new THREE.Vector3().setFromMatrixPosition(virtual.matrixWorld);
    expect(p.x).toBeCloseTo(4);
    expect(p.y).toBeCloseTo(DATUM - 6);
    expect(p.z).toBeCloseTo(-820);
  });

  it('places the reflection of P where its mirror point appears on screen, at u′ = 1 − u', () => {
    for (const [x, y, z] of [
      [12, DATUM + 9, -880],
      [-6, DATUM + 2.5, -850],
      [20, DATUM + 25, -930],
    ] as const) {
      const p = new THREE.Vector3(x, y, z);
      const mirrorImage = new THREE.Vector3(x, 2 * DATUM - y, z);
      const onScreen = ndc(main, mirrorImage);
      const inTarget = ndc(virtual, p);
      // NDC → u is 0.5x + 0.5, so u′ = 1 − u ⇔ x′ = −x.
      const u = onScreen.x * 0.5 + 0.5;
      expect(inTarget.x * 0.5 + 0.5).toBeCloseTo(mirroredReflectionU(u), 5);
      expect(inTarget.y).toBeCloseTo(onScreen.y, 5);
    }
  });

  it('clips everything below the water plane through the oblique near plane (both renderers)', () => {
    const above = ndc(virtual, new THREE.Vector3(10, DATUM + 3, -860));
    const below = ndc(virtual, new THREE.Vector3(10, DATUM - 3, -860));
    expect(above.z).toBeGreaterThan(-1);
    expect(above.z).toBeLessThan(1);
    expect(below.z).toBeLessThan(-1);
  });

  it('uses the [0, 1] depth near plane on the WebGPU coordinate system', () => {
    const gpuMain = camera([4, DATUM + 6, -820], [10, DATUM - 2, -870]);
    gpuMain.coordinateSystem = THREE.WebGPUCoordinateSystem;
    gpuMain.updateProjectionMatrix();
    const gpuVirtual = new THREE.PerspectiveCamera();
    expect(updateMirrorCamera(gpuMain, gpuVirtual, DATUM)).toBe(true);
    expect(gpuVirtual.coordinateSystem).toBe(THREE.WebGPUCoordinateSystem);
    const above = ndc(gpuVirtual, new THREE.Vector3(10, DATUM + 3, -860));
    const below = ndc(gpuVirtual, new THREE.Vector3(10, DATUM - 3, -860));
    expect(above.z).toBeGreaterThan(0);
    expect(above.z).toBeLessThan(1);
    expect(below.z).toBeLessThan(0);
  });
});

describe('frustumReachesBelow', () => {
  it('is true when the water plane can be on screen', () => {
    expect(frustumReachesBelow(camera([0, 10, 0], [0, 10, -10]), 0)).toBe(true);
  });

  it('is false looking up at the rim', () => {
    const up = camera([0, 10, 0], [0, 100, -1]);
    expect(frustumReachesBelow(up, 0)).toBe(false);
  });
});
