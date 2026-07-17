/**
 * DORMANT WebGPU migration seed — not wired into the live renderer.
 * Retained as the subject of the #255 guard. See docs/reference/RENDERER_CONTRACT.md.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  float,
  vec2,
  vec3,
  uniform,
  attribute,
  uv,
  positionWorld,
  normalWorld,
  cameraPosition,
  smoothstep,
  mix,
  dot,
  normalize,
  sin,
  clamp,
  max,
  min,
  abs,
  step,
} from 'three/tsl';
import { fbm4 } from './tsl/noise';

const GEOLOGICAL_LAYERS = {
  bedrock: '#3d3530',
  sedimentary: '#5c5048',
  granite: '#7a7068',
  moss: '#4a5a40',
  soil: '#5a5040',
};

const BIOME_ADAPTATIONS: Record<
  string,
  {
    mossColor: string;
    soilColor: string;
    weatheringIntensity: number;
    bedrockColor?: string;
    sedimentaryColor?: string;
    graniteColor?: string;
  }
> = {
  summer: { mossColor: '#587248', soilColor: '#5a5040', weatheringIntensity: 0.8 },
  autumn: { mossColor: '#7a6640', soilColor: '#6a5848', weatheringIntensity: 0.9 },
  alpine: { mossColor: '#4a5a50', soilColor: '#505850', weatheringIntensity: 0.6 },
  sunset: { mossColor: '#6a5840', soilColor: '#705848', weatheringIntensity: 0.85 },
  midnight: { mossColor: '#3a4a40', soilColor: '#3a4038', weatheringIntensity: 0.7 },
  slotCanyon: {
    mossColor: '#5a3a1a',
    soilColor: '#c87840',
    weatheringIntensity: 1.0,
    bedrockColor: '#5c2a1a',
    sedimentaryColor: '#a85a30',
    graniteColor: '#d4884c',
  },
};

export interface CanyonMaterialOptions {
  biome?: string;
  wallHeight?: number;
  parallaxScale?: number;
  time?: number;
  flowSpeed?: number;
  mossCoverage?: number;
  highWaterMark?: number;
  highWaterIntensity?: number;
}

export interface CanyonUniformRefs {
  time: ReturnType<typeof uniform>;
  wallHeight: ReturnType<typeof uniform>;
  parallaxScale: ReturnType<typeof uniform>;
  flowSpeed: ReturnType<typeof uniform>;
  mossCoverage: ReturnType<typeof uniform>;
  highWaterMark: ReturnType<typeof uniform>;
  highWaterIntensity: ReturnType<typeof uniform>;
  weatheringIntensity: ReturnType<typeof uniform>;
  bedrockColor: ReturnType<typeof uniform>;
  sedimentaryColor: ReturnType<typeof uniform>;
  graniteColor: ReturnType<typeof uniform>;
  mossColor: ReturnType<typeof uniform>;
  soilColor: ReturnType<typeof uniform>;
}

function buildCanyonColorNode(uniforms: CanyonUniformRefs) {
  const {
    time,
    wallHeight,
    parallaxScale,
    flowSpeed,
    mossCoverage,
    highWaterMark,
    highWaterIntensity,
    weatheringIntensity,
    bedrockColor,
    sedimentaryColor,
    graniteColor,
    mossColor,
    soilColor,
  } = uniforms;

  const worldPos = positionWorld;
  const worldNormal = normalize(normalWorld);
  const viewDir = normalize(cameraPosition.sub(worldPos));
  const vertexColor = attribute('color', 'vec3');
  const mossMaskAttr = attribute('mossMask', 'float');
  const highWaterMaskAttr = attribute('highWaterMask', 'float');

  const surfaceNoise = fbm4(worldPos.xz.mul(0.15)).mul(0.3).add(fbm4(worldPos.xz.mul(0.5)).mul(0.1));
  const h = clamp(
    worldPos.y.add(5).div(wallHeight).add(surfaceNoise.mul(0.05)),
    float(0),
    float(1)
  );

  const parallaxOffset = viewDir.xy.mul(parallaxScale).mul(float(1).sub(dot(worldNormal, vec3(0, 1, 0))));
  const sampleUv = uv().add(parallaxOffset);

  let color = bedrockColor;

  const layerMix1 = smoothstep(float(0), float(0.5), h).sub(smoothstep(float(0.5), float(0.7), h));
  color = mix(color, sedimentaryColor, layerMix1);

  const layerMix2 = smoothstep(float(0.5), float(0.7), h).sub(smoothstep(float(0.7), float(0.85), h));
  color = mix(color, graniteColor, layerMix2);

  const baseCoverage = smoothstep(float(0.8), float(0.95), h);
  const noiseVar = fbm4(sampleUv.mul(2).add(time.mul(0.01))).mul(0.4).add(0.6);
  const proceduralCoverage = baseCoverage.mul(noiseVar).mul(weatheringIntensity);
  const authoredCoverage = mossMaskAttr.mul(mossCoverage);
  const mossAmt = max(proceduralCoverage.mul(0.4), authoredCoverage);
  color = mix(color, mossColor, mossAmt.mul(0.7));

  const layerMix5 = smoothstep(float(0.95), float(1), h);
  color = mix(color, soilColor, layerMix5);

  const macroNoise = fbm4(worldPos.xz.mul(0.012).add(vec2(91, 47)));
  const macroWarm = vec3(1.05, 0.97, 0.9);
  const macroCool = vec3(0.92, 0.97, 1.04);
  color = color.mul(mix(macroWarm, macroCool, macroNoise));
  color = color.mul(float(0.9).add(macroNoise.mul(0.2)));

  const pocketNoise = fbm4(worldPos.xz.mul(0.22).add(vec2(worldPos.y.mul(0.05).add(7), float(3))));
  const shadowPocket = smoothstep(float(0.6), float(0.85), pocketNoise).mul(
    float(1).sub(smoothstep(float(0.85), float(1), pocketNoise))
  );
  color = color.mul(float(1).sub(shadowPocket.mul(0.6)));

  const veinNoise = fbm4(worldPos.xz.mul(0.55).add(vec2(worldPos.y.mul(0.35).add(31), float(-17))));
  const vein = float(1)
    .sub(abs(veinNoise.mul(2).sub(1)))
    .mul(smoothstep(float(0.965), float(0.99), veinNoise))
    .mul(smoothstep(float(0.3), float(0.55), macroNoise));
  const veinColor = mix(vec3(0.92, 0.8, 0.5), vec3(0.85, 0.92, 0.95), step(float(0.5), macroNoise));
  color = mix(color, veinColor, vein.mul(0.85));

  const explosionNoise = fbm4(worldPos.xz.mul(0.07).add(vec2(13.7, -8.2)));
  const mossExplosion = smoothstep(float(0.74), float(0.9), explosionNoise).mul(
    smoothstep(float(0.05), float(0.4), h)
  );
  color = mix(color, mossColor.mul(1.6), mossExplosion.mul(0.5));

  const causticPattern = sin(worldPos.x.mul(0.6).add(time.mul(1.3))).mul(
    sin(worldPos.z.mul(0.6).sub(time.mul(1)))
  );
  const causticBand = float(1)
    .sub(smoothstep(float(0), float(0.18), h))
    .mul(smoothstep(float(0), float(0.05), h));
  color = color.add(causticPattern.mul(causticBand).mul(0.05).mul(weatheringIntensity));

  const flowAnim = time.mul(float(0.03).add(flowSpeed.mul(0.02)));
  const streak0 = smoothstep(
    float(0.6),
    float(0.9),
    fbm4(vec2(sampleUv.x.mul(0.3).add(sin(sampleUv.y.mul(0.5).add(flowAnim)).mul(0.3)).mul(3), sampleUv.y.mul(0.2).sub(flowAnim)))
  );
  const streak1 = smoothstep(
    float(0.6),
    float(0.9),
    fbm4(vec2(sampleUv.x.mul(0.3).add(sin(sampleUv.y.mul(0.5).add(10).add(flowAnim)).mul(0.3)).mul(3), sampleUv.y.mul(0.2).sub(flowAnim)))
  );
  const streak2 = smoothstep(
    float(0.6),
    float(0.9),
    fbm4(vec2(sampleUv.x.mul(0.3).add(sin(sampleUv.y.mul(0.5).add(20).add(flowAnim)).mul(0.3)).mul(3), sampleUv.y.mul(0.2).sub(flowAnim)))
  );
  const streaks = streak0.add(streak1).add(streak2).mul(0.3);
  const lowerBand = max(float(0), highWaterMark.sub(0.14));
  const upperBand = min(float(1), highWaterMark.add(0.26));
  const streakBand = float(1).sub(smoothstep(lowerBand, upperBand, h));
  const weatheringStreaks = streaks.mul(streakBand).mul(weatheringIntensity);
  color = mix(color, color.mul(0.7), weatheringStreaks);

  const crackSeed = fbm4(vec2(worldPos.x.mul(0.08).add(worldPos.z.mul(0.04)), worldPos.z.mul(0.09)));
  const anchor = smoothstep(float(0.62), float(0.92), crackSeed);
  const verticalRun = smoothstep(float(0.2), float(0.95), float(1).sub(h));
  const waviness = fbm4(vec2(worldPos.x.mul(0.12), worldPos.y.mul(0.08).sub(time.mul(0.04))));
  const stripe = smoothstep(float(0.58), float(0.86), waviness);
  const seeps = anchor.mul(verticalRun).mul(stripe).mul(weatheringIntensity);
  const mineralTint = mix(vec3(0.28, 0.22, 0.16), vec3(0.48, 0.34, 0.22), smoothstep(float(0.1), float(0.75), h));
  color = mix(color, color.mul(0.58), seeps.mul(0.55));
  color = mix(color, mineralTint, seeps.mul(0.16));

  const crackNoise = fbm4(sampleUv.mul(4).add(vec2(time.mul(0.02).add(flowSpeed.mul(0.03)), time.mul(-0.01))));
  const cracks = smoothstep(float(0.7), float(0.75), crackNoise).mul(0.3);
  color = mix(color, color.mul(0.6), cracks);

  const floodStripe = clamp(highWaterMaskAttr.mul(highWaterIntensity), float(0), float(1));
  const luma = dot(color, vec3(0.299, 0.587, 0.114));
  const floodDesat = mix(color, vec3(luma), floodStripe.mul(0.55));
  color = mix(color, floodDesat.mul(0.82), floodStripe);

  const detailNoise = fbm4(sampleUv.mul(8)).mul(0.1).sub(0.05);
  color = color.add(detailNoise);

  const rim = float(1).sub(dot(worldNormal, viewDir));
  const rimFactor = smoothstep(float(0.4), float(0.8), rim);
  const rimColor = vec3(0.3, 0.25, 0.2).mul(rimFactor).mul(0.3);
  color = color.add(rimColor);

  const heatGlow = vec3(1.0, 0.45, 0.15).mul(rimFactor).mul(weatheringIntensity).mul(0.4);
  color = color.add(heatGlow);

  color = color.mul(vertexColor);

  return color;
}

export function createCanyonNodeMaterial(options: CanyonMaterialOptions = {}): MeshBasicNodeMaterial {
  const {
    biome = 'summer',
    wallHeight = 15,
    parallaxScale,
    time = 0,
    flowSpeed = 1.0,
    mossCoverage = 0.85,
    highWaterMark = 0.15,
    highWaterIntensity = 0.35,
  } = options;

  const biomeAdapt = BIOME_ADAPTATIONS[biome] || BIOME_ADAPTATIONS.summer;
  const defaultParallaxScale = biome === 'slotCanyon' ? 0.025 : 0.012;

  const uniforms: CanyonUniformRefs = {
    time: uniform(time),
    wallHeight: uniform(wallHeight),
    parallaxScale: uniform(parallaxScale ?? defaultParallaxScale),
    flowSpeed: uniform(flowSpeed),
    mossCoverage: uniform(Math.max(0, mossCoverage)),
    highWaterMark: uniform(Math.min(0.4, Math.max(0, highWaterMark))),
    highWaterIntensity: uniform(Math.max(0, highWaterIntensity)),
    weatheringIntensity: uniform(biomeAdapt.weatheringIntensity),
    bedrockColor: uniform(new THREE.Color(biomeAdapt.bedrockColor || GEOLOGICAL_LAYERS.bedrock)),
    sedimentaryColor: uniform(new THREE.Color(biomeAdapt.sedimentaryColor || GEOLOGICAL_LAYERS.sedimentary)),
    graniteColor: uniform(new THREE.Color(biomeAdapt.graniteColor || GEOLOGICAL_LAYERS.granite)),
    mossColor: uniform(new THREE.Color(biomeAdapt.mossColor)),
    soilColor: uniform(new THREE.Color(biomeAdapt.soilColor)),
  };

  const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.lights = false;
  material.colorNode = buildCanyonColorNode(uniforms);
  material.userData.canyonUniforms = uniforms;

  return material;
}

export function updateCanyonNodeMaterial(
  material: MeshBasicNodeMaterial,
  deltaTime: { flowSpeed?: number; mossCoverage?: number; highWaterMark?: number; highWaterIntensity?: number } | number,
  elapsedTime: number
) {
  const refs = material.userData.canyonUniforms as CanyonUniformRefs | undefined;
  if (!refs) return;

  refs.time.value = elapsedTime;

  const options = typeof deltaTime === 'object' && deltaTime !== null ? deltaTime : {};

  if (options.flowSpeed !== undefined) refs.flowSpeed.value = options.flowSpeed;
  if (options.mossCoverage !== undefined) refs.mossCoverage.value = Math.max(0, options.mossCoverage);
  if (options.highWaterMark !== undefined) {
    refs.highWaterMark.value = Math.min(0.4, Math.max(0, options.highWaterMark));
  }
  if (options.highWaterIntensity !== undefined) {
    refs.highWaterIntensity.value = Math.max(0, options.highWaterIntensity);
  }
}

export function createFallbackCanyonMaterial(options: { biome?: string } = {}) {
  const { biome = 'summer' } = options;
  const baseColor = biome === 'autumn' ? '#9c7850' : '#888880';
  return new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.8,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
}
