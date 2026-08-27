import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  float,
  length,
  mod,
  positionLocal,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

type NodeHandle = ReturnType<typeof float>;
const nd = (u: { value: unknown }): NodeHandle => u as unknown as NodeHandle;

export type WeatherKind = 'rain' | 'snow' | 'splash';

export interface WeatherParticleInit {
  kind: WeatherKind;
  time?: number;
  fallSpeed?: number;
  windX?: number;
  windZ?: number;
  cameraPos?: THREE.Vector3;
  globalAlpha?: number;
}

export function createWeatherParticleNodeMaterial(init: WeatherParticleInit): PointsNodeMaterial {
  const time = uniform(init.time ?? 0);
  const fallSpeed = uniform(init.fallSpeed ?? 1);
  const windX = uniform(init.windX ?? 0);
  const windZ = uniform(init.windZ ?? 0);
  const cameraPos = uniform(init.cameraPos?.clone() ?? new THREE.Vector3());
  const globalAlpha = uniform(init.globalAlpha ?? 0);
  const offset = attribute('offset', 'float');
  const speedVar = attribute('speedVar', 'float');

  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: init.kind === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
  });

  if (init.kind !== 'splash') {
    material.positionNode = Fn(() => {
      const fall = mod(nd(time).mul(nd(fallSpeed)).mul(speedVar).add(offset), 1);
      const cam = nd(cameraPos);
      let pos = vec3(positionLocal.x, cam.y.add(15).sub(fall.mul(30)), positionLocal.z);
      pos = vec3(pos.x.add(fall.mul(nd(windX))), pos.y, pos.z.add(fall.mul(nd(windZ))));
      return pos;
    })();
  }

  material.colorNode = Fn(() => {
    const d = length(uv().sub(vec2(0.5)));
    const a =
      init.kind === 'rain'
        ? float(1).sub(smoothstep(float(0), float(0.5), uv().x.sub(0.5).abs().mul(0.15).add(uv().y.sub(0.5).abs().mul(1.8))))
        : float(1).sub(smoothstep(float(0.2), float(0.5), d));
    const tint = init.kind === 'snow' ? vec3(0.95, 0.98, 1.0) : vec3(0.75, 0.8, 0.9);
    return vec4(tint, a.mul(nd(globalAlpha)));
  })();

  material.userData.uniforms = { time, fallSpeed, windX, windZ, cameraPos, globalAlpha };
  material.userData.materialBackend = 'tsl';
  return material;
}
