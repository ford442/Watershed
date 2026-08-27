import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';
import {
  CLOUD_FRAGMENT,
  CLOUD_VERTEX,
  SKY_DOME_FRAGMENT,
  SKY_DOME_VERTEX,
  STAR_FRAGMENT,
  STAR_VERTEX,
} from './skyShaders';
import type { CloudUniformInit, SkyDomeInit } from './SkyNodeMaterial';

export { CLOUD_FRAGMENT, CLOUD_VERTEX, STAR_FRAGMENT, STAR_VERTEX } from './skyShaders';

const warned = { current: false };

function tag(material: THREE.Material, backend: MaterialBackend): THREE.Material {
  material.userData.materialBackend = backend;
  return material;
}

export function createCloudMaterial(backend: MaterialBackend, init: CloudUniformInit): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.sky) {
    try {
      return tag(nodes.sky.createCloudNodeMaterial(init) as unknown as THREE.Material, 'tsl');
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createCloudMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return tag(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        time: { value: init.time ?? 0 },
        opacity: { value: init.opacity },
        sunsetBlend: { value: init.sunsetBlend },
        overcastBlend: { value: init.overcastBlend },
        cloudColorA: { value: init.cloudColorA.clone() },
        cloudColorB: { value: init.cloudColorB.clone() },
        sunDir2D: { value: init.sunDir2D.clone() },
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
    }),
    'glsl',
  );
}

export function createStarMaterial(
  backend: MaterialBackend,
  init: { uTime?: number; uOpacity: number },
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.sky) {
    try {
      return tag(nodes.sky.createStarNodeMaterial(init) as unknown as THREE.Material, 'tsl');
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createStarMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return tag(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uTime: { value: init.uTime ?? 0 },
        uOpacity: { value: init.uOpacity },
      },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
    }),
    'glsl',
  );
}

export function createMoonMaterial(backend: MaterialBackend, phase: number): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.sky) {
    try {
      return tag(nodes.sky.createMoonNodeMaterial(phase) as unknown as THREE.Material, 'tsl');
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createMoonMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({
    color: '#cfd6e2',
    emissive: '#3a4252',
    emissiveIntensity: 0.4,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = { value: phase };
    shader.fragmentShader =
      `uniform float uPhase;\n` +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
float terminator = smoothstep(-0.15, 0.15, normalize(vNormal).x - (uPhase - 0.5) * 2.0);
gl_FragColor.rgb *= mix(0.18, 1.0, terminator);
#include <dithering_fragment>
`,
      );
    mat.userData.shader = shader;
    mat.userData.uniforms = shader.uniforms;
  };
  mat.needsUpdate = true;
  return tag(mat, 'glsl');
}

export function createSkyDomeMaterial(backend: MaterialBackend, init: SkyDomeInit): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.sky) {
    try {
      return tag(nodes.sky.createSkyDomeNodeMaterial(init) as unknown as THREE.Material, 'tsl');
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createSkyDomeMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return tag(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenithColor: { value: init.zenithColor.clone() },
        horizonColor: { value: init.horizonColor.clone() },
        sunColor: { value: init.sunColor.clone() },
        sunDir: { value: init.sunDir.clone() },
      },
      vertexShader: SKY_DOME_VERTEX,
      fragmentShader: SKY_DOME_FRAGMENT,
    }),
    'glsl',
  );
}

export function resetSkyMaterialWarnings(): void {
  warned.current = false;
}
