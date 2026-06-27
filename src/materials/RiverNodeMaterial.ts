import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  float,
  vec2,
  vec3,
  uniform,
  attribute,
  texture,
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
  pow,
  abs,
  step,
  materialColor,
  materialRoughness,
} from 'three/tsl';
import { WALL_WATERLINE_Y, SHADERS, ROCK_SHADER } from '../constants/game';
import { MOSS_HEIGHT_FADE, MOSS_NORMAL_MASK } from './tsl/riverConstants';
import { fbm2, riverNoise, hash2 } from './tsl/noise';

const WHITE_TEXTURE = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
})();

export interface RiverMaterialOptions {
  enableWetness?: boolean;
  enableMoss?: boolean;
  enableTriplanar?: boolean;
  waterLevel?: number;
  wetnessRange?: number;
}

export interface RiverUniformRefs {
  uTime: ReturnType<typeof uniform>;
  uWaterLevel: ReturnType<typeof uniform>;
  uWetnessRange: ReturnType<typeof uniform>;
  uWeatherWetness: ReturnType<typeof uniform>;
}

function buildRiverColorNode(
  options: Required<RiverMaterialOptions>,
  uniforms: RiverUniformRefs,
  colorMap: THREE.Texture,
  displacementTex: THREE.Texture
) {
  const { enableWetness, enableMoss, enableTriplanar } = options;
  const { uTime, uWaterLevel, uWetnessRange, uWeatherWetness } = uniforms;

  const uMossColor = uniform(new THREE.Color(SHADERS.MOSS_COLOR));
  const uLichenColor = uniform(new THREE.Color(SHADERS.LICHEN_COLOR));
  const uMossIntensity = uniform(0.6);
  const uCrackIntensity = uniform(ROCK_SHADER.CRACK_INTENSITY);
  const uCrackScale = uniform(ROCK_SHADER.CRACK_SCALE);
  const uStratificationStrength = uniform(ROCK_SHADER.STRATIFICATION_STRENGTH);
  const uStratificationScale = uniform(ROCK_SHADER.STRATIFICATION_SCALE);
  const uWarmColor = uniform(new THREE.Color(ROCK_SHADER.WARM_COLOR));
  const uCoolColor = uniform(new THREE.Color(ROCK_SHADER.COOL_COLOR));
  const uColorVariationStrength = uniform(ROCK_SHADER.COLOR_VARIATION_STRENGTH);
  const uDisplacementScale = uniform(ROCK_SHADER.DISPLACEMENT_SCALE);
  const uColorMap = texture(colorMap);
  const dispTex = texture(displacementTex);

  const worldPos = positionWorld;
  const worldNormal = normalize(normalWorld);
  const viewDir = normalize(cameraPosition.sub(worldPos));
  const heightAboveWater = worldPos.y.sub(uWaterLevel);

  const dispHeight = dispTex.uv(uv()).r;
  const parallaxOffset = viewDir.xy.mul(dispHeight).mul(uDisplacementScale);

  let diffuse = materialColor.rgb;

  if (enableTriplanar) {
    const uv2Attr = attribute('uv2', 'vec2');
    const triplanarSample = uColorMap.uv(uv2Attr.add(parallaxOffset));
    const triplanarBlend = smoothstep(float(3), float(12), heightAboveWater);
    const cliffBlend = pow(
      float(1).sub(abs(dot(worldNormal, vec3(0, 1, 0)))),
      float(1.35)
    );
    const projectionBlend = clamp(max(triplanarBlend, cliffBlend.mul(0.85)), float(0), float(1));
    diffuse = mix(diffuse, triplanarSample.rgb, projectionBlend.mul(0.85));
  }

  const macroNoise = fbm2(worldPos.xz.mul(0.01).add(vec2(91, 47)));
  const macroWarm = vec3(1.05, 0.97, 0.9);
  const macroCool = vec3(0.92, 0.97, 1.04);
  diffuse = diffuse.mul(mix(macroWarm, macroCool, macroNoise));
  diffuse = diffuse.mul(float(0.9).add(macroNoise.mul(0.2)));

  const pocketNoise = fbm2(worldPos.xz.mul(0.2).add(vec2(worldPos.y.mul(0.05).add(11), float(-4))));
  const shadowPocket = smoothstep(float(0.6), float(0.85), pocketNoise).mul(
    float(1).sub(smoothstep(float(0.85), float(1), pocketNoise))
  );
  diffuse = diffuse.mul(float(1).sub(shadowPocket.mul(0.55)));

  const veinNoise = fbm2(worldPos.xz.mul(0.5).add(vec2(worldPos.y.mul(0.3).add(33), float(-19))));
  const vein = float(1)
    .sub(abs(veinNoise.mul(2).sub(1)))
    .mul(smoothstep(float(0.96), float(0.99), veinNoise))
    .mul(smoothstep(float(0.3), float(0.55), macroNoise));
  const veinColor = mix(vec3(0.92, 0.8, 0.5), vec3(0.85, 0.92, 0.95), step(float(0.5), macroNoise));
  diffuse = mix(diffuse, veinColor, vein.mul(0.85));

  const causticPattern = sin(worldPos.x.mul(0.6).add(uTime.mul(1.3))).mul(
    sin(worldPos.z.mul(0.6).sub(uTime.mul(1)))
  );
  const causticBand = smoothstep(uWetnessRange, float(0), abs(heightAboveWater));
  diffuse = diffuse.add(causticPattern.mul(causticBand).mul(0.04));

  let highWaterMaskAttr = float(0);

  if (enableMoss) {
    const mossMaskAttr = attribute('mossMask', 'float');
    highWaterMaskAttr = attribute('highWaterMask', 'float');

    const explosionNoise = riverNoise(worldPos.xz.mul(0.06).add(13.7));
    const mossExplosion = smoothstep(float(0.74), float(0.9), explosionNoise)
      .mul(smoothstep(float(-1), float(2), heightAboveWater))
      .mul(float(1).sub(smoothstep(float(3), float(6), heightAboveWater)));
    diffuse = mix(diffuse, uMossColor.mul(1.7), mossExplosion.mul(0.45));

    const maskMax = max(mossMaskAttr, highWaterMaskAttr);
    const mossNoise = riverNoise(worldPos.xz.mul(0.5).add(uTime.mul(0.05)));
    const mossNoise2 = riverNoise(worldPos.xz.mul(1.2).sub(uTime.mul(0.03)));
    const heightFactor = smoothstep(float(0), float(3), heightAboveWater);
    const growthColor = mix(uMossColor, uLichenColor, heightFactor);
    const floodBand = clamp(highWaterMaskAttr.mul(1.15), float(0), float(1));
    const intensity = max(mossMaskAttr, floodBand.mul(0.65))
      .mul(uMossIntensity)
      .mul(float(0.7).add(mossNoise.mul(0.3)))
      .mul(float(0.8).add(mossNoise2.mul(0.2)));
    const mossHeightFade = float(1).sub(
      smoothstep(float(MOSS_HEIGHT_FADE.low), float(MOSS_HEIGHT_FADE.high), heightAboveWater)
    );
    const normalFactor = smoothstep(
      float(MOSS_NORMAL_MASK.low),
      float(MOSS_NORMAL_MASK.high),
      dot(worldNormal, vec3(0, 1, 0))
    );
    const mossIntensity = intensity.mul(mossHeightFade).mul(normalFactor);
    const mossActive = step(float(0.08), maskMax);
    diffuse = mix(diffuse, growthColor, mossIntensity.mul(mossActive));
  }

  if (enableWetness) {
    const wetnessNoise = fbm2(worldPos.xz.mul(0.3).add(vec2(worldPos.y.mul(0.15), float(0)))).mul(1.6).sub(0.8);
    const wetRange = max(float(0.05), uWetnessRange.add(wetnessNoise));
    const baseWetness = float(1).sub(smoothstep(float(0), wetRange, heightAboveWater));
    const weatherWetnessFactor = uWeatherWetness.mul(
      float(1).sub(smoothstep(float(0), wetRange.mul(1.5), heightAboveWater))
    );
    const combinedWetness = clamp(baseWetness.add(weatherWetnessFactor), float(0), float(1));
    const wetDarken = float(1).sub(combinedWetness.mul(1 - ROCK_SHADER.WETNESS_DARKEN));
    diffuse = diffuse.mul(wetDarken);
  }

  const crackNoise = fbm2(worldPos.xz.mul(uCrackScale).add(parallaxOffset.mul(2)));
  const crackMask = smoothstep(float(0.55), float(0.65), crackNoise);
  diffuse = diffuse.mul(float(1).sub(crackMask.mul(uCrackIntensity)));

  const stratWarp = fbm2(worldPos.xz.mul(uStratificationScale.mul(0.35)).add(vec2(4.1, -2.7)));
  const strat = sin(
    worldPos.y.mul(uStratificationScale).add(stratWarp.mul(4.5)).add(hash2(worldPos.xz).mul(2))
  )
    .mul(0.5)
    .add(0.5);
  const stratContrast = smoothstep(float(0.18), float(0.82), strat);
  diffuse = mix(diffuse, diffuse.mul(float(0.78).add(stratContrast.mul(0.32))), uStratificationStrength.mul(0.7));

  const heightRatio = clamp(heightAboveWater.div(12), float(0), float(1));
  const heightTint = mix(uWarmColor, uCoolColor, heightRatio);
  diffuse = mix(diffuse, heightTint, uColorVariationStrength.mul(float(0.35).add(heightRatio.mul(0.65))));

  if (enableMoss) {
    diffuse = diffuse.mul(float(1).sub(clamp(highWaterMaskAttr, float(0), float(1)).mul(0.08)));
  }

  return { color: diffuse, heightAboveWater, uWetnessRange, uWeatherWetness };
}

function buildRiverRoughnessNode(
  heightAboveWater: ReturnType<typeof float>,
  uWetnessRange: ReturnType<typeof uniform>,
  uWeatherWetness: ReturnType<typeof uniform>,
  enableWetness: boolean
) {
  if (!enableWetness) return undefined;

  const baseWetnessR = float(1).sub(smoothstep(float(0), uWetnessRange, heightAboveWater));
  const weatherWetnessR = uWeatherWetness.mul(
    float(1).sub(smoothstep(float(0), uWetnessRange.mul(1.5), heightAboveWater))
  );
  const combinedWetnessR = clamp(baseWetnessR.add(weatherWetnessR), float(0), float(1));
  return materialRoughness.mul(float(1).sub(combinedWetnessR.mul(0.35)));
}

export function createRiverNodeMaterial(
  parameters: THREE.MeshStandardMaterialParameters = {},
  options: RiverMaterialOptions = {}
): MeshStandardNodeMaterial {
  const {
    enableWetness = true,
    enableMoss = true,
    enableTriplanar = true,
    waterLevel = WALL_WATERLINE_Y,
    wetnessRange = 4.0,
  } = options;

  const colorMap = parameters.map || WHITE_TEXTURE;
  const displacementTex = parameters.displacementMap || WHITE_TEXTURE;

  const uTime = uniform(0);
  const uWaterLevel = uniform(waterLevel);
  const uWetnessRange = uniform(wetnessRange);
  const uWeatherWetness = uniform(0);

  const uniforms: RiverUniformRefs = { uTime, uWaterLevel, uWetnessRange, uWeatherWetness };

  const { color, heightAboveWater } = buildRiverColorNode(
    { enableWetness, enableMoss, enableTriplanar, waterLevel, wetnessRange },
    uniforms,
    colorMap,
    displacementTex
  );

  const textureProps: Partial<THREE.MeshStandardMaterialParameters> = {};
  if (parameters.map) textureProps.map = parameters.map;
  if (parameters.normalMap) textureProps.normalMap = parameters.normalMap;
  if (parameters.roughnessMap) textureProps.roughnessMap = parameters.roughnessMap;
  if (parameters.aoMap) textureProps.aoMap = parameters.aoMap;
  if (parameters.displacementMap) textureProps.displacementMap = parameters.displacementMap;

  const material = new MeshStandardNodeMaterial({
    roughness: parameters.roughness ?? 0.9,
    metalness: parameters.metalness ?? 0.1,
    color: parameters.color,
    vertexColors: parameters.vertexColors,
    side: parameters.side,
    transparent: parameters.transparent,
    opacity: parameters.opacity,
    ...textureProps,
  });

  material.colorNode = color;
  const roughnessNode = buildRiverRoughnessNode(
    heightAboveWater,
    uWetnessRange,
    uWeatherWetness,
    enableWetness
  );
  if (roughnessNode) {
    material.roughnessNode = roughnessNode;
  }

  material.userData.riverUniforms = uniforms;
  material.userData.riverShader = { waterLevel, wetnessRange, time: 0 };

  return material;
}

export function copyStandardPropsToRiverMaterial(
  source: THREE.MeshStandardMaterial,
  options: RiverMaterialOptions = {}
): MeshStandardNodeMaterial {
  return createRiverNodeMaterial(
    {
      map: source.map ?? undefined,
      normalMap: source.normalMap ?? undefined,
      roughnessMap: source.roughnessMap ?? undefined,
      aoMap: source.aoMap ?? undefined,
      displacementMap: source.displacementMap ?? undefined,
      color: source.color?.clone(),
      roughness: source.roughness,
      metalness: source.metalness,
      vertexColors: source.vertexColors,
      side: source.side,
      transparent: source.transparent,
      opacity: source.opacity,
    },
    options
  );
}

export function updateRiverNodeMaterial(
  material: MeshStandardNodeMaterial,
  time: number,
  options: { waterLevel?: number; weatherWetness?: number } | number = {}
) {
  const refs = material.userData.riverUniforms as RiverUniformRefs | undefined;
  if (!refs) return;

  refs.uTime.value = time;

  if (typeof options === 'number') {
    refs.uWaterLevel.value = options;
  } else if (options && typeof options === 'object') {
    if (options.waterLevel !== undefined) refs.uWaterLevel.value = options.waterLevel;
    if (options.weatherWetness !== undefined) refs.uWeatherWetness.value = options.weatherWetness;
  }
}
