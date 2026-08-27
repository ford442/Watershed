import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';

const warned = { current: false };

function attachGlslFlap(mat: THREE.Material): THREE.Material {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader =
      `
uniform float uTime;
attribute vec3 aHinge;
attribute float aFlap;
attribute float instancePhase;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
#include <begin_vertex>
if (aFlap != 0.0) {
  float flapFreq = 24.0 + instancePhase * 10.0;
  float phaseOffset = aFlap > 0.0 ? 0.0 : 3.14159;
  float flapAngle = sin(uTime * flapFreq + instancePhase * 6.2831 + phaseOffset) * 0.65 + 0.15;
  vec3 rel = transformed - aHinge;
  float ca = cos(flapAngle);
  float sa = sin(flapAngle);
  vec3 rotated = vec3(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca, rel.z);
  transformed = aHinge + rotated;
}
`,
    );
    mat.userData.shader = shader;
  };
  mat.needsUpdate = true;
  return mat;
}

function attachGlslSwim(mat: THREE.Material): THREE.Material {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader =
      `
uniform float uTime;
attribute float aTailWeight;
attribute float instancePhase;
attribute float instanceFreq;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
#include <begin_vertex>
float swimWave = sin(uTime * instanceFreq + instancePhase * 6.2831 + transformed.z * -3.0);
transformed.x += swimWave * 0.16 * aTailWeight;
`,
    );
    mat.userData.shader = shader;
  };
  mat.needsUpdate = true;
  return mat;
}

function attachGlslRing(mat: THREE.Material): THREE.Material {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `
attribute float ringAlpha;
varying float vRingAlpha;
` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvRingAlpha = ringAlpha;`,
      );
    shader.fragmentShader =
      `varying float vRingAlpha;\n` +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\ngl_FragColor.a *= vRingAlpha;`,
      );
    mat.userData.shader = shader;
  };
  mat.needsUpdate = true;
  return mat;
}

export function createDragonflyBodyMaterial(
  backend: MaterialBackend,
  source: THREE.MeshStandardMaterial,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.critters) {
    try {
      return nodes.critters.createDragonflyBodyNodeMaterial(source) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createDragonflyBodyMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return attachGlslFlap(source);
}

export function createDragonflyWingMaterial(
  backend: MaterialBackend,
  source: THREE.Material,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.critters && source instanceof THREE.MeshStandardMaterial) {
    try {
      return nodes.critters.createDragonflyBodyNodeMaterial(source) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createDragonflyWingMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return attachGlslFlap(source);
}

export function createFishBodyMaterial(
  backend: MaterialBackend,
  source: THREE.MeshStandardMaterial,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.critters) {
    try {
      return nodes.critters.createFishNodeMaterial(source) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createFishBodyMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return attachGlslSwim(source);
}

export function createFishRingMaterial(
  backend: MaterialBackend,
  source: THREE.MeshBasicMaterial,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.critters) {
    try {
      return nodes.critters.createFishRingNodeMaterial(source) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createFishRingMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }
  return attachGlslRing(source);
}

export function resetCritterMaterialWarnings(): void {
  warned.current = false;
}
