import * as THREE from 'three';
import { loadNodeMaterials } from './nodeMaterials';
import { createCloudMaterial, createMoonMaterial, createSkyDomeMaterial, createStarMaterial, resetSkyMaterialWarnings } from './sky/createSkyMaterials';
import { createWeatherParticleMaterial, resetWeatherMaterialWarnings } from './weather/createWeatherParticleMaterial';
import { resetVfxMaterialWarnings } from './vfx/vfxDualFactory';
import {
  createRainbowMaterial,
  createPondFogMaterial,
  createSplashBowWaveMaterial,
  createRockFoamMaterial,
} from './vfx/createVfxMaterials';
import {
  createVegetationSurfaceMaterial,
  createTreeSurfaceMaterial,
  createRockSurfaceMaterial,
  resetFoliageSurfaceWarnings,
} from './foliage/createFoliageSurfaceMaterial';
import {
  createFishBodyMaterial,
  createFishRingMaterial,
  resetCritterMaterialWarnings,
} from './critters/createCritterMaterials';

beforeAll(async () => {
  await loadNodeMaterials();
});

beforeEach(() => {
  resetSkyMaterialWarnings();
  resetWeatherMaterialWarnings();
  resetVfxMaterialWarnings();
  resetFoliageSurfaceWarnings();
  resetCritterMaterialWarnings();
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

  it('builds TSL moon and sky dome materials without throwing', () => {
    const moon = createMoonMaterial('tsl', 0.35);
    const dome = createSkyDomeMaterial('tsl', {
      zenithColor: new THREE.Color('#1a2a4a'),
      horizonColor: new THREE.Color('#8aa0c0'),
      sunColor: new THREE.Color('#ffd080'),
      sunDir: new THREE.Vector3(0.2, 0.8, 0.1),
    });
    expect(moon.userData.materialBackend).toBe('tsl');
    expect(dome.userData.materialBackend).toBe('tsl');
  });

  it('builds weather particle materials on both backends', () => {
    const glsl = createWeatherParticleMaterial('glsl', { kind: 'rain' });
    const tsl = createWeatherParticleMaterial('tsl', { kind: 'rain' });
    expect((glsl as THREE.ShaderMaterial).isShaderMaterial).toBe(true);
    expect(tsl.userData.materialBackend).toBe('tsl');
  });

  it('builds dedicated VFX materials on the TSL backend', () => {
    const rainbow = createRainbowMaterial('tsl', {
      opacity: 0.4,
      sunDirection: new THREE.Vector3(0, 1, 0),
    });
    const fog = createPondFogMaterial('tsl', { tintColor: new THREE.Color('#ccc') });
    const splash = createSplashBowWaveMaterial('tsl');
    const foam = createRockFoamMaterial('tsl', { flowSpeed: 1, colorBase: new THREE.Color('#fff') });
    expect(rainbow.userData.materialBackend).toBe('tsl');
    expect(fog.userData.materialBackend).toBe('tsl');
    expect(splash.userData.materialBackend).toBe('tsl');
    expect(foam.userData.materialBackend).toBe('tsl');
  });

  it('builds foliage and critter node surfaces on the TSL backend', () => {
    const source = new THREE.MeshStandardMaterial({ color: '#3a5' });
    const vegetation = createVegetationSurfaceMaterial('tsl', source, { windStrength: 0.1 });
    const tree = createTreeSurfaceMaterial('tsl', source);
    const rock = createRockSurfaceMaterial('tsl', source);
    const fish = createFishBodyMaterial('tsl', source);
    const ring = createFishRingMaterial('tsl', new THREE.MeshBasicMaterial({ color: '#fff' }));
    expect(vegetation.userData.materialBackend).toBe('tsl');
    expect(tree.userData.materialBackend).toBe('tsl');
    expect(rock.userData.materialBackend).toBe('tsl');
    expect(fish.userData.materialBackend).toBe('tsl');
    expect(ring.userData.materialBackend).toBe('tsl');
  });
});
