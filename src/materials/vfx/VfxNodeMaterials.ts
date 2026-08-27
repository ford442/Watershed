import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  float,
  length,
  mix,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';

type NodeHandle = ReturnType<typeof float>;
const nd = (u: { value: unknown }): NodeHandle => u as unknown as NodeHandle;

/**
 * Generic TSL stand-in for leftover VFX ShaderMaterials: tint + radial fade +
 * a little time wobble. Dedicated graphs (sky/weather/water) live elsewhere.
 */
export function createGenericVfxNodeMaterial(
  params: THREE.ShaderMaterialParameters,
): MeshBasicNodeMaterial {
  const src = params.uniforms ?? {};
  const colorKey =
    ['colorBase', 'waterColor', 'tintColor', 'foamColor'].find((k) => k in src) ?? null;
  const baseColor =
    colorKey && src[colorKey]?.value instanceof THREE.Color
      ? (src[colorKey].value as THREE.Color).clone()
      : new THREE.Color('#ffffff');

  const time = uniform(typeof src.time?.value === 'number' ? src.time.value : 0);
  const opacity = uniform(
    typeof src.opacity?.value === 'number'
      ? src.opacity.value
      : typeof src.globalAlpha?.value === 'number'
        ? src.globalAlpha.value
        : typeof src.baseOpacity?.value === 'number'
          ? src.baseOpacity.value
          : 1,
  );
  const tint = uniform(baseColor);

  const bag: Record<string, { value: unknown }> = { time, opacity, tint };
  for (const [key, u] of Object.entries(src)) {
    if (key === 'time') bag.time = time;
    else if (key === 'opacity' || key === 'globalAlpha' || key === 'baseOpacity') bag[key] = opacity;
    else if (key === colorKey) bag[key] = tint;
    else bag[key] = u;
  }

  const material = new MeshBasicNodeMaterial({
    transparent: params.transparent ?? true,
    depthWrite: params.depthWrite ?? false,
    side: params.side ?? THREE.FrontSide,
    blending: params.blending ?? THREE.NormalBlending,
  });
  material.positionNode = positionLocal.add(vec3(sin(nd(time)).mul(0.02), 0, 0));
  material.colorNode = Fn(() => {
    const d = length(uv().sub(0.5));
    const fade = smoothstep(float(0.55), float(0.0), d);
    return vec4(nd(tint), fade.mul(nd(opacity)));
  })();
  material.userData.uniforms = bag;
  material.userData.materialBackend = 'tsl';
  return material;
}
