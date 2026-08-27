import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, positionLocal, sin, uniform, vec3 } from 'three/tsl';

type NodeHandle = ReturnType<typeof float>;
const nd = (u: { value: unknown }): NodeHandle => u as unknown as NodeHandle;

export function createDragonflyBodyNodeMaterial(source: THREE.MeshStandardMaterial): MeshStandardNodeMaterial {
  const uTime = uniform(0);
  const material = new MeshStandardNodeMaterial({
    color: source.color,
    roughness: source.roughness,
    metalness: source.metalness,
  });
  const aFlap = attribute('aFlap', 'float');
  const aHinge = attribute('aHinge', 'vec3');
  const instancePhase = attribute('instancePhase', 'float');
  const flapAngle = sin(nd(uTime).mul(24).add(instancePhase.mul(6.2831))).mul(0.65).add(0.15);
  material.positionNode = mix(positionLocal, aHinge.add(positionLocal.sub(aHinge)), aFlap.abs().min(1));
  material.userData.uniforms = { uTime, flapAngle };
  material.userData.materialBackend = 'tsl';
  material.userData.shader = { uniforms: { uTime } };
  return material;
}

export function createFishNodeMaterial(source: THREE.MeshStandardMaterial): MeshStandardNodeMaterial {
  const uTime = uniform(0);
  const material = new MeshStandardNodeMaterial({
    color: source.color,
    roughness: source.roughness,
    metalness: source.metalness,
    vertexColors: source.vertexColors,
    side: source.side,
  });
  const aTailWeight = attribute('aTailWeight', 'float');
  const instancePhase = attribute('instancePhase', 'float');
  const instanceFreq = attribute('instanceFreq', 'float');
  const swim = sin(nd(uTime).mul(instanceFreq).add(instancePhase.mul(6.2831)).add(positionLocal.z.mul(-3)));
  material.positionNode = positionLocal.add(vec3(swim.mul(0.16).mul(aTailWeight), 0, 0));
  material.userData.uniforms = { uTime };
  material.userData.materialBackend = 'tsl';
  material.userData.shader = { uniforms: { uTime } };
  return material;
}

export function createFishRingNodeMaterial(source: THREE.MeshBasicMaterial): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    color: source.color,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ringAlpha = attribute('ringAlpha', 'float');
  material.opacityNode = ringAlpha;
  material.userData.materialBackend = 'tsl';
  return material;
}
