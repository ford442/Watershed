import * as THREE from 'three';
import {
  MOSS_HEIGHT_FADE,
  MOSS_NORMAL_MASK,
  mossNormalFactor,
  worldNormalFromLocal,
} from '../materials/tsl/riverConstants';
import { extendRiverMaterial, updateRiverMaterial } from './RiverShader';

describe('riverConstants', () => {
  test('mossNormalFactor peaks on upward-facing normals', () => {
    expect(mossNormalFactor(1)).toBeCloseTo(1, 2);
    expect(mossNormalFactor(0)).toBeCloseTo(0, 2);
    expect(mossNormalFactor(-1)).toBeCloseTo(0, 2);
  });

  test('mossNormalFactor uses configured thresholds', () => {
    const mid = (MOSS_NORMAL_MASK.low + MOSS_NORMAL_MASK.high) / 2;
    expect(mossNormalFactor(mid)).toBeGreaterThan(0.4);
    expect(mossNormalFactor(MOSS_NORMAL_MASK.low - 0.01)).toBe(0);
    expect(mossNormalFactor(MOSS_NORMAL_MASK.high + 0.01)).toBe(1);
  });

  test('worldNormalFromLocal matches matrix transform for identity-scale mesh', () => {
    const matrix = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const local: [number, number, number] = [0, 1, 0];
    const [wx, wy, wz] = worldNormalFromLocal(local, matrix.elements);
    const world = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).normalize();
    expect(wx).toBeCloseTo(world.x, 5);
    expect(wy).toBeCloseTo(world.y, 5);
    expect(wz).toBeCloseTo(world.z, 5);
    expect(mossNormalFactor(world.y)).toBeCloseTo(mossNormalFactor(1), 5);
  });

  test('height fade constants match RiverShader band', () => {
    expect(MOSS_HEIGHT_FADE.low).toBe(2.0);
    expect(MOSS_HEIGHT_FADE.high).toBe(4.5);
  });
});

describe('extendRiverMaterial', () => {
  test('installs onBeforeCompile on MeshStandardMaterial', () => {
    const base = new THREE.MeshStandardMaterial({ color: '#808080', roughness: 0.9 });
    const material = extendRiverMaterial(base, { enableMoss: true });

    expect(material).toBe(base);
    expect(typeof material.onBeforeCompile).toBe('function');
    expect(material.userData.riverShader).toBeDefined();
  });

  test('preserves moss mask thresholds via shared constants', () => {
    expect(MOSS_NORMAL_MASK.low).toBe(0.15);
    expect(MOSS_NORMAL_MASK.high).toBe(0.82);
  });

  test('updateRiverMaterial writes shader uniform values after compile', () => {
    const material = extendRiverMaterial(new THREE.MeshStandardMaterial(), {
      waterLevel: 13,
      wetnessRange: 4,
    });

    const shader = {
      uniforms: {
        uTime: { value: 0 },
        uWaterLevel: { value: 13 },
        uWeatherWetness: { value: 0 },
      },
    };
    material.onBeforeCompile(shader);
    material.userData.shader = shader;

    updateRiverMaterial(material, 1.5, { waterLevel: 12, weatherWetness: 0.4 });

    expect(shader.uniforms.uTime.value).toBe(1.5);
    expect(shader.uniforms.uWaterLevel.value).toBe(12);
    expect(shader.uniforms.uWeatherWetness.value).toBe(0.4);
  });
});
