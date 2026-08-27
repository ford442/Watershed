import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn,
  clamp,
  cos,
  float,
  mix,
  positionLocal,
  positionWorld,
  sin,
  uniform,
  vec3,
} from 'three/tsl';
import type { TreeShaderOptions } from '../../utils/TreeShader';
import type { VegetationShaderOptions } from '../../utils/VegetationShader';
import type { RockShaderOptions } from '../../utils/RockShader';

type NodeHandle = ReturnType<typeof float>;
const nd = (u: { value: unknown }): NodeHandle => u as unknown as NodeHandle;

function copyStandard(source: THREE.MeshStandardMaterial, extra?: THREE.MeshStandardMaterialParameters) {
  return new MeshStandardNodeMaterial({
    color: source.color,
    map: source.map,
    roughness: source.roughness,
    metalness: source.metalness,
    emissive: source.emissive,
    emissiveIntensity: source.emissiveIntensity,
    vertexColors: source.vertexColors,
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    ...extra,
  });
}

export function createTreeNodeMaterial(
  source: THREE.MeshStandardMaterial,
  options: TreeShaderOptions = {},
): MeshStandardNodeMaterial {
  const windStrength = uniform(options.windStrength ?? 0.12);
  const windSpeed = uniform(options.windSpeed ?? 1.6);
  const uTime = uniform(0);
  const uPlayerPos = uniform(new THREE.Vector3(1e6, 1e6, 1e6));
  const material = copyStandard(source, { side: THREE.DoubleSide });
  material.positionNode = Fn(() => {
    const sway = sin(nd(uTime).mul(nd(windSpeed)).add(positionWorld.x)).mul(nd(windStrength));
    return positionLocal.add(vec3(sway, 0, sway.mul(0.4)));
  })();
  material.userData.treeUniforms = { uPlayerPos };
  material.userData.uniforms = { uTime, uWindStrength: windStrength, uWindSpeed: windSpeed, uPlayerPos };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function updateTreeNodeMaterial(
  material: THREE.Material,
  time: number,
  playerPos?: THREE.Vector3,
): void {
  const u = material.userData.uniforms as Record<string, { value: unknown }> | undefined;
  if (u?.uTime) u.uTime.value = time;
  if (playerPos && material.userData.treeUniforms?.uPlayerPos?.value instanceof THREE.Vector3) {
    material.userData.treeUniforms.uPlayerPos.value.copy(playerPos);
  }
  if (playerPos && u?.uPlayerPos?.value instanceof THREE.Vector3) {
    u.uPlayerPos.value.copy(playerPos);
  }
}

export function createVegetationNodeMaterial(
  source: THREE.MeshStandardMaterial,
  options: VegetationShaderOptions = {},
): MeshStandardNodeMaterial {
  const plantHeight = uniform(options.plantHeight ?? 1);
  const windStrength = uniform(options.windStrength ?? 0.06);
  const windSpeed = uniform(options.windSpeed ?? 1.4);
  const uTime = uniform(0);
  const bob = options.mode === 'bob';
  const material = copyStandard(source);
  material.positionNode = Fn(() => {
    const phase = positionWorld.x.mul(0.9).add(positionWorld.z.mul(1.4));
    if (bob) {
      const vegBob = sin(nd(uTime).mul(nd(windSpeed)).mul(0.6).add(phase)).mul(nd(windStrength));
      return positionLocal.add(
        vec3(
          sin(nd(uTime).mul(nd(windSpeed)).mul(0.4).add(phase.mul(1.3))).mul(nd(windStrength)).mul(0.4),
          vegBob,
          cos(nd(uTime).mul(nd(windSpeed)).mul(0.5).add(phase.mul(0.9))).mul(nd(windStrength)).mul(0.4),
        ),
      );
    }
    const heightWeight = clamp(positionLocal.y.div(nd(plantHeight)), 0, 1);
    const w = heightWeight.mul(heightWeight);
    const sway = sin(nd(uTime).mul(nd(windSpeed)).add(phase)).mul(nd(windStrength));
    return positionLocal.add(
      vec3(
        sway.mul(w),
        0,
        cos(nd(uTime).mul(nd(windSpeed)).mul(0.8).add(phase.mul(0.6))).mul(nd(windStrength)).mul(0.5).mul(w),
      ),
    );
  })();
  material.userData.vegetationShader = options;
  material.userData.uniforms = { uTime, uWindStrength: windStrength, uWindSpeed: windSpeed, uPlantHeight: plantHeight };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function updateVegetationNodeMaterial(
  material: THREE.Material,
  time: number,
  intensity = 1,
): void {
  const u = material.userData.uniforms as Record<string, { value: number }> | undefined;
  const base = material.userData.vegetationShader as VegetationShaderOptions | undefined;
  if (u?.uTime) u.uTime.value = time;
  if (u?.uWindStrength) u.uWindStrength.value = (base?.windStrength ?? 0.06) * intensity;
}

export function createRockNodeMaterial(
  source: THREE.MeshStandardMaterial,
  options: RockShaderOptions = {},
): MeshStandardNodeMaterial {
  const moss = uniform(options.mossStrength ?? 0.4);
  const material = copyStandard(source);
  const baseColor = uniform(source.color.clone());
  const mossColor = uniform(new THREE.Color(options.mossColor ?? '#3f5c2a'));
  material.colorNode = mix(baseColor, mossColor, moss.mul(0.35));
  material.userData.uniforms = { uMossStrength: moss };
  material.userData.materialBackend = 'tsl';
  return material;
}
