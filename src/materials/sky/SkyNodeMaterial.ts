import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  length,
  mix,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { fbm2 } from '../tsl/noise';

type NodeHandle = ReturnType<typeof float>;
const nd = (u: { value: unknown }): NodeHandle => u as unknown as NodeHandle;

export interface CloudUniformInit {
  time?: number;
  opacity: number;
  sunsetBlend: number;
  overcastBlend: number;
  cloudColorA: THREE.Color;
  cloudColorB: THREE.Color;
  sunDir2D: THREE.Vector3;
}

export function createCloudNodeMaterial(init: CloudUniformInit): MeshBasicNodeMaterial {
  const time = uniform(init.time ?? 0);
  const opacity = uniform(init.opacity);
  const sunsetBlend = uniform(init.sunsetBlend);
  const overcastBlend = uniform(init.overcastBlend);
  const cloudColorA = uniform(init.cloudColorA.clone());
  const cloudColorB = uniform(init.cloudColorB.clone());
  const sunDir2D = uniform(init.sunDir2D.clone());

  const colorNode = Fn(() => {
    const scrolled = uv().mul(2.8).add(vec2(nd(time).mul(0.003), nd(time).mul(0.0018)));
    const n = fbm2(scrolled);
    const cloud = smoothstep(float(0.52), float(0.8), n);
    const nSun = fbm2(scrolled.add(vec2(nd(sunDir2D).x, nd(sunDir2D).z).mul(0.18)));
    const cloudSun = smoothstep(float(0.52), float(0.8), nSun);
    const litFactor = clamp(float(0.5).add(cloud.sub(cloudSun).mul(1.6)), 0, 1);
    const cloudColor = mix(nd(cloudColorA), nd(cloudColorB), nd(sunsetBlend));
    const shadowColor = cloudColor.mul(0.55);
    const highlightColor = mix(cloudColor, vec3(1.0, 0.98, 0.92), 0.55);
    const litColor = mix(shadowColor, highlightColor, litFactor);
    const overcast = mix(litColor, vec3(0.55, 0.57, 0.6), nd(overcastBlend).mul(0.85));
    const coverage = mix(cloud, clamp(cloud.add(0.35), 0, 1), nd(overcastBlend));
    return vec4(overcast, coverage.mul(nd(opacity)));
  })();

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.colorNode = colorNode;
  material.userData.uniforms = {
    time,
    opacity,
    sunsetBlend,
    overcastBlend,
    cloudColorA,
    cloudColorB,
    sunDir2D,
  };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createStarNodeMaterial(init: { uTime?: number; uOpacity: number }): PointsNodeMaterial {
  const uTime = uniform(init.uTime ?? 0);
  const uOpacity = uniform(init.uOpacity);
  const aSize = attribute('aSize', 'float');
  const aPhase = attribute('aPhase', 'float');
  const aSpeed = attribute('aSpeed', 'float');
  const twinkle = float(0.55).add(sin(nd(uTime).mul(aSpeed).add(aPhase)).mul(0.45));
  const vertexColor = attribute('color', 'vec3');

  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  material.sizeNode = aSize.mul(twinkle).mul(4);
  material.colorNode = Fn(() => {
    const d = length(uv().sub(0.5));
    const core = smoothstep(float(0.5), float(0.0), d);
    return vec4(vertexColor, core.mul(twinkle).mul(nd(uOpacity)));
  })();
  material.userData.uniforms = { uTime, uOpacity };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createMoonNodeMaterial(phase: number): MeshStandardNodeMaterial {
  const uPhase = uniform(phase);
  const material = new MeshStandardNodeMaterial({
    color: '#cfd6e2',
    emissive: '#3a4252',
    emissiveIntensity: 0.4,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0,
  });
  const terminator = Fn(() => {
    const n = normalize(positionWorld.sub(cameraPosition).mul(-1));
    return smoothstep(float(-0.15), float(0.15), n.x.sub(nd(uPhase).sub(0.5).mul(2.0)));
  })();
  material.colorNode = vec3(0.81, 0.84, 0.89).mul(mix(float(0.18), float(1.0), terminator));
  material.userData.uniforms = { uPhase };
  material.userData.materialBackend = 'tsl';
  return material;
}

export interface SkyDomeInit {
  zenithColor: THREE.Color;
  horizonColor: THREE.Color;
  sunColor: THREE.Color;
  sunDir: THREE.Vector3;
}

export function createSkyDomeNodeMaterial(init: SkyDomeInit): MeshBasicNodeMaterial {
  const zenithColor = uniform(init.zenithColor.clone());
  const horizonColor = uniform(init.horizonColor.clone());
  const sunColor = uniform(init.sunColor.clone());
  const sunDir = uniform(init.sunDir.clone());

  const material = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  material.colorNode = Fn(() => {
    const dir = normalize(positionWorld);
    const h = clamp(dir.y.mul(0.5).add(0.5), 0, 1);
    const col = mix(nd(horizonColor), nd(zenithColor), h);
    const sun = pow(clamp(dot(dir, normalize(nd(sunDir))), 0, 1), 32);
    return col.add(nd(sunColor).mul(sun).mul(0.65));
  })();
  material.userData.uniforms = { zenithColor, horizonColor, sunColor, sunDir };
  material.userData.materialBackend = 'tsl';
  return material;
}
