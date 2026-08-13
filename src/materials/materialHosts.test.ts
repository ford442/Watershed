/**
 * Host guards for the river and canyon surfaces (#256 path A, phase 2).
 *
 * Both hosts have the same job as the water one: pick a backend, never throw,
 * and route per-frame updates to whichever material was actually built.
 */

import * as THREE from 'three';
import {
  createRiverSurfaceMaterial,
  isRiverNodeSurface,
  resetRiverSurfaceWarnings,
  updateRiverSurfaceMaterial,
} from './river/createRiverSurfaceMaterial';
import {
  createCanyonSurfaceMaterial,
  isCanyonNodeSurface,
  resetCanyonSurfaceWarnings,
  updateCanyonSurfaceMaterial,
} from './canyon/createCanyonSurfaceMaterial';
import { loadNodeMaterials, resetNodeMaterialsCache } from './nodeMaterials';

const standardSource = () =>
  new THREE.MeshStandardMaterial({ color: '#8B7355', roughness: 0.85 });

beforeAll(async () => {
  await loadNodeMaterials();
});

beforeEach(() => {
  resetRiverSurfaceWarnings();
  resetCanyonSurfaceWarnings();
});

describe('createRiverSurfaceMaterial', () => {
  it('extends the source material in place on the GLSL backend', () => {
    const source = standardSource();
    const material = createRiverSurfaceMaterial('glsl', source);

    expect(material).toBe(source);
    expect(isRiverNodeSurface(material)).toBe(false);
  });

  it('builds a separate node material on the TSL backend, leaving the source alone', () => {
    const source = standardSource();
    const material = createRiverSurfaceMaterial('tsl', source);

    expect(material).not.toBe(source);
    expect(isRiverNodeSurface(material)).toBe(true);
  });

  it('stays on GLSL for a source material with no node equivalent', () => {
    const basic = new THREE.MeshBasicMaterial();
    const material = createRiverSurfaceMaterial('tsl', basic);

    expect(isRiverNodeSurface(material)).toBe(false);
  });

  it('stays on GLSL when the node module is not loaded', async () => {
    resetNodeMaterialsCache();
    const material = createRiverSurfaceMaterial('tsl', standardSource());

    expect(isRiverNodeSurface(material)).toBe(false);
    await loadNodeMaterials();
  });

  it('drives the TSL uniform bag from the shared update call', () => {
    const material = createRiverSurfaceMaterial('tsl', standardSource());
    updateRiverSurfaceMaterial(material, 12.5, { waterLevel: 3, weatherWetness: 0.4 });

    const uniforms = material.userData.riverUniforms as Record<string, { value: number }>;
    expect(uniforms.uTime.value).toBe(12.5);
    expect(uniforms.uWaterLevel.value).toBe(3);
    expect(uniforms.uWeatherWetness.value).toBe(0.4);
  });

  it('tolerates a null material in the update path', () => {
    expect(() => updateRiverSurfaceMaterial(null, 1)).not.toThrow();
  });
});

describe('createCanyonSurfaceMaterial', () => {
  it('builds the legacy ShaderMaterial on the GLSL backend', () => {
    const material = createCanyonSurfaceMaterial('glsl', { biome: 'slotCanyon' });

    expect((material as THREE.ShaderMaterial).isShaderMaterial).toBe(true);
    expect(isCanyonNodeSurface(material)).toBe(false);
  });

  it('builds the node material on the TSL backend', () => {
    const material = createCanyonSurfaceMaterial('tsl', { biome: 'slotCanyon' });

    expect(isCanyonNodeSurface(material)).toBe(true);
    expect((material as THREE.ShaderMaterial).isShaderMaterial).toBeFalsy();
  });

  it('drives the TSL uniform bag from the shared update call', () => {
    const material = createCanyonSurfaceMaterial('tsl', { biome: 'slotCanyon' });
    updateCanyonSurfaceMaterial(material, { flowSpeed: 3.5, highWaterMark: 0.3 }, 7.25);

    const uniforms = material.userData.canyonUniforms as Record<string, { value: number }>;
    expect(uniforms.time.value).toBe(7.25);
    expect(uniforms.flowSpeed.value).toBe(3.5);
    expect(uniforms.highWaterMark.value).toBeCloseTo(0.3, 5);
  });

  it('clamps the high-water mark the same way as the GLSL path', () => {
    const material = createCanyonSurfaceMaterial('tsl', { biome: 'slotCanyon' });
    updateCanyonSurfaceMaterial(material, { highWaterMark: 5 }, 0);

    const uniforms = material.userData.canyonUniforms as Record<string, { value: number }>;
    expect(uniforms.highWaterMark.value).toBe(0.4);
  });

  it('still updates the GLSL material through the same call', () => {
    const material = createCanyonSurfaceMaterial('glsl', { biome: 'slotCanyon' });
    updateCanyonSurfaceMaterial(material, { flowSpeed: 2 }, 4);

    const uniforms = (material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.time.value).toBe(4);
    expect(uniforms.flowSpeed.value).toBe(2);
  });
});
