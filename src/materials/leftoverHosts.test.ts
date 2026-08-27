import * as THREE from 'three';
import { loadNodeMaterials } from './nodeMaterials';
import { createCloudMaterial, createStarMaterial, resetSkyMaterialWarnings } from './sky/createSkyMaterials';
import { createWeatherParticleMaterial, resetWeatherMaterialWarnings } from './weather/createWeatherParticleMaterial';
import { createBackendShaderMaterial, resetBackendShaderWarnings } from './vfx/createBackendShaderMaterial';
import {
  createVegetationSurfaceMaterial,
  resetFoliageSurfaceWarnings,
} from './foliage/createFoliageSurfaceMaterial';

beforeAll(async () => {
  await loadNodeMaterials();
});

beforeEach(() => {
  resetSkyMaterialWarnings();
  resetWeatherMaterialWarnings();
  resetBackendShaderWarnings();
  resetFoliageSurfaceWarnings();
});

describe('leftover GLSL dual-path hosts', () => {
  it('builds TSL cloud and star materials without throwing', () => {
    const cloud = createCloudMaterial('tsl', {
      opacity: 0.4,
      sunsetBlend: 0,
      overcastBlend: 0,
      cloudColorA: new THREE.Color('#fff'),
      cloudColorB: new THREE.Color('#ccc'),
      sunDir2D: new THREE.Vector3(1, 0, 0),
    });
    const stars = createStarMaterial('tsl', { uOpacity: 0.2 });
    expect(cloud.userData.materialBackend).toBe('tsl');
    expect(stars.userData.materialBackend).toBe('tsl');
  });

  it('builds weather particle materials on both backends', () => {
    const glsl = createWeatherParticleMaterial('glsl', { kind: 'rain' });
    const tsl = createWeatherParticleMaterial('tsl', { kind: 'rain' });
    expect((glsl as THREE.ShaderMaterial).isShaderMaterial).toBe(true);
    expect(tsl.userData.materialBackend).toBe('tsl');
  });

  it('routes generic VFX through the backend factory', () => {
    const glsl = createBackendShaderMaterial('glsl', {
      transparent: true,
      uniforms: { time: { value: 0 }, colorBase: { value: new THREE.Color('#fff') } },
      vertexShader: 'void main() { gl_Position = vec4(0.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    });
    const tsl = createBackendShaderMaterial('tsl', {
      transparent: true,
      uniforms: { time: { value: 0 }, colorBase: { value: new THREE.Color('#fff') } },
      vertexShader: 'void main() { gl_Position = vec4(0.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    });
    expect((glsl as THREE.ShaderMaterial).isShaderMaterial).toBe(true);
    expect(tsl.userData.materialBackend).toBe('tsl');
  });

  it('builds a vegetation node surface on the TSL backend', () => {
    const source = new THREE.MeshStandardMaterial({ color: '#3a5' });
    const material = createVegetationSurfaceMaterial('tsl', source, { windStrength: 0.1 });
    expect(material.userData.materialBackend).toBe('tsl');
    expect(material).not.toBe(source);
  });
});
