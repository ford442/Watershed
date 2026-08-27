import * as THREE from 'three';
import { MeshBasicNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  length,
  mix,
  normalize,
  positionLocal,
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

function tintedRadialMaterial(
  color: THREE.Color,
  opacity: number,
  blending: THREE.Blending,
  side: THREE.Side = THREE.FrontSide,
): MeshBasicNodeMaterial {
  const time = uniform(0);
  const tint = uniform(color.clone());
  const alpha = uniform(opacity);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending,
    side,
  });
  material.positionNode = positionLocal.add(vec3(sin(nd(time)).mul(0.02), cos(nd(time).mul(0.6)).mul(0.015), 0));
  material.colorNode = Fn(() => {
    const d = length(uv().sub(0.5));
    const fade = smoothstep(float(0.55), float(0.0), d);
    const shimmer = sin(nd(time).add(uv().x.mul(8))).mul(0.08).add(0.92);
    return vec4(nd(tint), fade.mul(nd(alpha)).mul(shimmer));
  })();
  material.userData.uniforms = { time, tint, colorBase: tint, opacity: alpha };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createRainbowNodeMaterial(init: {
  opacity: number;
  sunDirection: THREE.Vector3;
}): MeshBasicNodeMaterial {
  const time = uniform(0);
  const opacity = uniform(init.opacity);
  const sunDirection = uniform(init.sunDirection.clone().normalize());
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = Fn(() => {
    const hue = float(1).sub(uv().x).mul(0.75);
    const inner = smoothstep(float(0.0), float(0.18), uv().y);
    const outer = float(1).sub(smoothstep(float(0.82), float(1.0), uv().y));
    const widthMask = inner.mul(outer);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const n = normalize(vec3(0, 1, 0));
    const fresnel = pow(float(1).sub(clamp(abs(dot(n, viewDir)), 0, 1)), 1.8);
    const shimmer = float(0.92).add(sin(nd(time).mul(0.9).add(uv().x.mul(10))).mul(0.08));
    const sunLift = float(0.7).add(
      clamp(dot(normalize(nd(sunDirection)), vec3(0, 1, 0)), 0, 1).mul(0.3),
    );
    const r = clamp(abs(hue.mul(6).sub(0)), 0, 1);
    const g = clamp(abs(hue.mul(6).sub(2)), 0, 1);
    const b = clamp(abs(hue.mul(6).sub(4)), 0, 1);
    const rainbow = vec3(r, g, b).mul(0.95);
    const alpha = nd(opacity).mul(widthMask).mul(fresnel).mul(shimmer).mul(sunLift);
    return vec4(rainbow, alpha);
  })();
  material.userData.uniforms = { time, opacity, sunDirection };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createPondFogNodeMaterial(init: {
  opacity?: number;
  tintColor: THREE.Color;
}): MeshBasicNodeMaterial {
  const time = uniform(0);
  const opacity = uniform(init.opacity ?? 0);
  const tintColor = uniform(init.tintColor.clone());
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  material.colorNode = Fn(() => {
    const scrolled = uv().mul(3).add(vec2(nd(time).mul(0.015), sin(nd(time).mul(0.07)).mul(0.3)));
    const swirl = fbm2(scrolled);
    const bank = smoothstep(float(0.35), float(0.85), swirl);
    const edgeFade = smoothstep(float(0.5), float(0.05), length(uv().sub(0.5)));
    return vec4(nd(tintColor), bank.mul(edgeFade).mul(nd(opacity)));
  })();
  material.userData.uniforms = { time, opacity, tintColor };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createSplashBowWaveNodeMaterial(): MeshBasicNodeMaterial {
  const time = uniform(0);
  const material = new MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });
  material.positionNode = Fn(() => {
    const noise = sin(positionLocal.x.mul(2).add(nd(time).mul(2)))
      .mul(cos(positionLocal.z.mul(1.5).add(nd(time).mul(1.5))))
      .mul(0.05);
    return positionLocal.add(vec3(0, noise, 0));
  })();
  material.colorNode = Fn(() => {
    const noise = sin(positionLocal.x.mul(2).add(nd(time).mul(2)))
      .mul(cos(positionLocal.z.mul(1.5).add(nd(time).mul(1.5))));
    const alpha = float(0.5).add(noise.mul(0.2)).mul(0.6);
    return vec4(vec3(0.667, 0.867, 1.0), alpha);
  })();
  material.userData.uniforms = { time };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createWaterfallSheetNodeMaterial(init: {
  flowSpeed: number;
  baseOpacity: number;
  layerOffset: number;
  waterColor: THREE.Color;
  deepColor: THREE.Color;
  foamColor: THREE.Color;
}): MeshBasicNodeMaterial {
  const time = uniform(0);
  const flowSpeed = uniform(init.flowSpeed);
  const baseOpacity = uniform(init.baseOpacity);
  const layerOffset = uniform(init.layerOffset);
  const waterColor = uniform(init.waterColor.clone());
  const deepColor = uniform(init.deepColor.clone());
  const foamColor = uniform(init.foamColor.clone());
  const curtainDepth = attribute('curtainDepth', 'float');
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.positionNode = Fn(() => {
    const billow = sin(positionLocal.y.mul(0.18).add(nd(time).mul(0.8).add(nd(layerOffset))).mul(0.12));
    const pull = smoothstep(float(0.45), float(1.0), curtainDepth).mul(0.25);
    return positionLocal.add(
      vec3(billow.mul(0.45).add(curtainDepth.mul(0.55)), 0, pull.add(sin(positionLocal.x.mul(0.2).add(nd(time).mul(0.5))).mul(0.08))),
    );
  })();
  material.colorNode = Fn(() => {
    const streakUv = vec2(uv().x.mul(1.9).add(nd(layerOffset)), float(1).sub(uv().y).mul(3.6).add(nd(time).mul(nd(flowSpeed).mul(2.8))));
    const streaks = fbm2(streakUv);
    const foam = smoothstep(float(0.52), float(0.84), streaks);
    const edgeThin = smoothstep(float(0.0), float(0.16), uv().x).mul(float(1).sub(smoothstep(float(0.84), float(1.0), uv().x)));
    const baseFoam = smoothstep(float(0.62), float(1.0), curtainDepth);
    const color = mix(nd(waterColor), nd(deepColor), smoothstep(float(0.05), float(0.9), curtainDepth));
    const lit = color.add(nd(foamColor).mul(foam.mul(0.16).add(baseFoam.mul(0.55))));
    const alpha = nd(baseOpacity).mul(edgeThin).mul(float(0.55).add(foam.mul(0.2).add(baseFoam.mul(0.35))));
    return vec4(lit, clamp(alpha, 0, 0.95));
  })();
  material.userData.uniforms = {
    time,
    flowSpeed,
    baseOpacity,
    layerOffset,
    waterColor,
    deepColor,
    foamColor,
  };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createWaterfallPlumeNodeMaterial(init: {
  intensity: number;
  colorBase: THREE.Color;
}): MeshBasicNodeMaterial {
  const time = uniform(0);
  const intensity = uniform(init.intensity);
  const colorBase = uniform(init.colorBase.clone());
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.colorNode = Fn(() => {
    const radial = smoothstep(float(0.55), float(0.0), length((uv().sub(0.5)).mul(vec2(1, 1.5))));
    const wisps = fbm2(uv().mul(5).add(vec2(0, uv().y.mul(2))));
    const alpha = radial.mul(smoothstep(float(0.2), float(0.85), wisps)).mul(nd(intensity).mul(0.35));
    return vec4(nd(colorBase), alpha);
  })();
  material.userData.uniforms = { time, intensity, colorBase };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createWaterfallFoamNodeMaterial(init: {
  flowSpeed: number;
  churnBoost: number;
  colorBase: THREE.Color;
}): MeshBasicNodeMaterial {
  const time = uniform(0);
  const flowSpeed = uniform(init.flowSpeed);
  const churnBoost = uniform(init.churnBoost);
  const colorBase = uniform(init.colorBase.clone());
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.colorNode = Fn(() => {
    const centered = uv().sub(0.5);
    const dist = length(centered);
    const ring = smoothstep(float(0.48), float(0.12), dist);
    const core = smoothstep(float(0.22), float(0.0), dist);
    const flowT = nd(time).mul(nd(flowSpeed));
    const swirlVec = vec2(flowT.mul(0.35), float(0).sub(flowT.mul(0.25)));
    const churnVec = vec2(float(0).sub(flowT.mul(0.6)), flowT.mul(0.45));
    const swirl = fbm2(centered.mul(7).add(swirlVec));
    const churn = fbm2(centered.mul(12).add(churnVec));
    const foam = smoothstep(float(0.38), float(0.95), swirl.mul(0.55).add(churn.mul(0.45)));
    const alpha = (ring.mul(0.45).add(core.mul(0.35))).mul(foam).mul(float(0.7).add(nd(churnBoost).mul(0.2)));
    return vec4(nd(colorBase), alpha);
  })();
  material.userData.uniforms = { time, flowSpeed, churnBoost, colorBase };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createSunShaftNodeMaterial(init: {
  flowSpeed: number;
  shaftOpacity: number;
  colorBase: THREE.Color;
  warmTint: THREE.Color;
}): MeshBasicNodeMaterial {
  const time = uniform(0);
  const flowSpeed = uniform(init.flowSpeed);
  const shaftOpacity = uniform(init.shaftOpacity);
  const colorBase = uniform(init.colorBase.clone());
  const warmTint = uniform(init.warmTint.clone());
  const timeOfDay = uniform(0.5);
  const speedStreak = uniform(0);
  const overcastBlend = uniform(0);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.colorNode = Fn(() => {
    const verticalFade = smoothstep(float(0.0), float(0.2), uv().y).mul(
      float(1).sub(smoothstep(float(0.8), float(1.0), uv().y)),
    );
    const noiseA = fbm2(positionWorld.xz.mul(0.3).add(vec2(float(0), float(0).sub(nd(time).mul(0.5)))));
    const shaft = smoothstep(float(0.3), float(0.7), noiseA);
    const edge = pow(float(1).sub(abs(uv().x.mul(2).sub(1))), 1.5);
    const midday = float(1).sub(abs(nd(timeOfDay).sub(0.5)).mul(2)).max(0);
    const goldenHour = smoothstep(float(0.65), float(0.9), nd(timeOfDay));
    const shaftColor = mix(nd(colorBase), nd(warmTint), goldenHour.mul(0.7));
    const alpha = verticalFade.mul(shaft).mul(nd(shaftOpacity)).mul(float(0.55).add(edge.mul(0.45))).mul(float(0.65).add(midday.mul(0.35)));
    const streak = smoothstep(float(0.82), float(1.0), sin(uv().y.add(nd(time).mul(1.2)).mul(35)).mul(0.5).add(0.5)).mul(nd(speedStreak)).mul(0.12);
    return vec4(shaftColor, alpha.mul(float(1).sub(nd(overcastBlend).mul(0.4))).add(streak));
  })();
  material.userData.uniforms = {
    time,
    flowSpeed,
    shaftOpacity,
    colorBase,
    warmTint,
    timeOfDay,
    speedStreak,
    overcastBlend,
    sunDirection: uniform(new THREE.Vector3(0.1, 1, 0.05).normalize()),
  };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createSunShaftMoteNodeMaterial(init: {
  colorBase: THREE.Color;
  opacity: number;
}): PointsNodeMaterial {
  const time = uniform(0);
  const flowSpeed = uniform(1);
  const colorBase = uniform(init.colorBase.clone());
  const opacity = uniform(init.opacity);
  const sunFacing = uniform(1);
  const aRadius = attribute('aRadius', 'float');
  const aPhase = attribute('aPhase', 'float');
  const aSpeed = attribute('aSpeed', 'float');
  const aHeight = attribute('aHeight', 'float');
  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = Fn(() => {
    const rise = sin(nd(time).mul(nd(aSpeed).mul(0.15)).add(nd(aPhase).mul(nd(aHeight))).mul(nd(aHeight)));
    return positionLocal.add(vec3(sin(nd(time).mul(nd(aSpeed))).mul(0.4), rise, cos(nd(time).mul(nd(aSpeed).mul(0.6))).mul(0.4)));
  })();
  material.sizeNode = aRadius.mul(nd(sunFacing)).mul(180);
  material.colorNode = Fn(() => {
    const twinkle = float(0.4).add(sin(nd(time).mul(1.5).add(nd(aPhase).mul(9))).mul(0.3));
    const d = length(uv().sub(0.5));
    const core = smoothstep(float(0.5), float(0.0), d);
    return vec4(nd(colorBase), core.mul(twinkle).mul(nd(opacity)));
  })();
  material.userData.uniforms = { time, flowSpeed, colorBase, opacity, sunFacing };
  material.userData.materialBackend = 'tsl';
  return material;
}

export function createMistNodeMaterial(init: { colorBase: THREE.Color }): MeshBasicNodeMaterial {
  return tintedRadialMaterial(init.colorBase, 0.35, THREE.NormalBlending);
}

export function createFireflyNodeMaterial(init: { colorBase: THREE.Color }): MeshBasicNodeMaterial {
  const mat = tintedRadialMaterial(init.colorBase, 0.8, THREE.AdditiveBlending);
  mat.userData.uniforms.colorBase = mat.userData.uniforms.tint;
  return mat;
}

export function createCanyonDustNodeMaterial(init: { colorBase: THREE.Color }): MeshBasicNodeMaterial {
  return tintedRadialMaterial(init.colorBase, 0.1, THREE.AdditiveBlending, THREE.DoubleSide);
}

export function createRockFoamNodeMaterial(init: {
  colorBase: THREE.Color;
  flowSpeed: number;
}): MeshBasicNodeMaterial {
  const time = uniform(0);
  const flowSpeed = uniform(init.flowSpeed);
  const colorBase = uniform(init.colorBase.clone());
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  material.colorNode = Fn(() => {
    const dist = length(uv().sub(0.5));
    const mask = pow(smoothstep(float(0.5), float(0.0), dist), 2);
    const flow = nd(time).mul(nd(flowSpeed));
    const n1 = fbm2(uv().mul(8).add(vec2(float(0), float(0).sub(flow.mul(2)))));
    const n2 = fbm2(uv().mul(3).add(vec2(float(0), float(0).sub(flow.mul(0.8)))));
    const foam = smoothstep(float(0.3), float(0.9), n1.mul(0.6).add(n2.mul(0.4)));
    return vec4(nd(colorBase), mask.mul(foam).mul(0.6));
  })();
  material.userData.uniforms = { time, flowSpeed, colorBase };
  material.userData.materialBackend = 'tsl';
  return material;
}

/** Legacy generic stand-in — prefer dedicated creators above. */
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
  return tintedRadialMaterial(
    baseColor,
    typeof src.opacity?.value === 'number' ? src.opacity.value : 1,
    params.blending ?? THREE.NormalBlending,
    params.side ?? THREE.FrontSide,
  );
}
