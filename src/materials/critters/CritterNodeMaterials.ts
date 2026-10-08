import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, positionLocal, sin, uniform, vec3 } from 'three/tsl';

export function createDragonflyBodyNodeMaterial(source: THREE.MeshStandardMaterial): MeshStandardNodeMaterial {
  const uTime = uniform(0);
  const material = new MeshStandardNodeMaterial({
    color: source.color,
    roughness: source.roughness,
    metalness: source.metalness,
  });
  const aFlap = attribute<'float'>('aFlap', 'float');
  const aHinge = attribute<'vec3'>('aHinge', 'vec3');
  const instancePhase = attribute<'float'>('instancePhase', 'float');
  const flapAngle = sin(uTime.mul(24).add(instancePhase.mul(6.2831))).mul(0.65).add(0.15);
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
  const aTailWeight = attribute<'float'>('aTailWeight', 'float');
  const instancePhase = attribute<'float'>('instancePhase', 'float');
  const instanceFreq = attribute<'float'>('instanceFreq', 'float');
  const swim = sin(uTime.mul(instanceFreq).add(instancePhase.mul(6.2831)).add(positionLocal.z.mul(-3)));
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
  const ringAlpha = attribute<'float'>('ringAlpha', 'float');
  material.opacityNode = ringAlpha;
  material.userData.materialBackend = 'tsl';
  return material;
}
