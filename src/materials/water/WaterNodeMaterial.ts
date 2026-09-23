/**
 * WaterNodeMaterial.ts — TSL/NodeMaterial port of the FlowingWater surface.
 *
 * Path A of #256: this is the `?material=tsl` implementation of the water shader.
 * It renders only under a node-capable renderer (WebGPURenderer, WebGL2 backend by
 * default) — classic THREE.WebGLRenderer has no node pipeline.
 *
 * PARITY: the displacement, foam, depth-tint, fresnel, caustics, specular, planar
 * reflection, god-ray, and alpha math below are line-for-line ports of the GLSL in
 * FlowingWater.tsx, using the same WATER_SHADER constants, so the two backends can
 * be compared directly.
 *
 * STAGE SPLIT (#399 phase A): the displacement field, its 4-sample normal, the wave
 * and current scalars, the world position, and the view direction are computed once
 * in the VERTEX stage and interpolated — the same varying set the GLSL vertex shader
 * writes (`vNormal` / `vWave` / `vCurrent` / `vWorldPos` / `vViewDir`). The fragment
 * stage no longer re-evaluates the displacement field five times per pixel.
 *
 * The flow-map branch mirrors the GLSL `USE_FLOWMAP` define: it is a BUILD-time
 * variant keyed on whether a flow map was supplied, not a runtime uniform, so a
 * boot without a flow map pays no sampler cost — exactly like the define.
 *
 * KNOWN GAP vs the GLSL surface (tracked in docs/reference/RENDERER.md):
 *   - dynamic per-biome fragment shader overrides (`useShaderLoader`). That hook
 *     fetches GLSL SOURCE TEXT from a backend and swaps it into the ShaderMaterial;
 *     there is no node-graph equivalent of "compile this string", so it is
 *     permanently GLSL-only rather than an unfinished port. A biome that sets
 *     `shaderId` gets its custom look on `?material=glsl` only.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  dot,
  float,
  length,
  max,
  mix,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  positionLocal,
  pow,
  reflect,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { WATER_SHADER } from '../../constants/game';
import { waterFbm2 as fbm2, waterFbm3 as fbm3 } from '../tsl/waterNoise';
import {
  WATER_TEXTURE_UNIFORM_NAMES,
  WATER_UNIFORM_NAMES,
  createWaterUniformValues,
  type WaterUniformInit,
  type WaterUniformName,
} from './waterUniformSpec';

/** 1×1 black texture — stands in for an unbound sampler (TSL needs a real texture). */
const BLACK_PIXEL = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
})();

/**
 * Node handle for a uniform. TSL's fluent API is untyped at this boundary, so a
 * single narrow cast here keeps every call site below readable and cast-free.
 */
type NodeHandle = ReturnType<typeof float>;
const nd = (u: { value: unknown }): NodeHandle => u as unknown as NodeHandle;

/** Uniform-node record, `.value`-addressable exactly like THREE.IUniform. */
export type WaterNodeUniforms = Record<WaterUniformName, { value: unknown }>;

export interface WaterNodeMaterial extends MeshBasicNodeMaterial {
  uniforms: WaterNodeUniforms;
  /** Node graph slot — assigned once at build time. */
  positionNode: unknown;
}

function buildUniformNodes(init: WaterUniformInit): WaterNodeUniforms {
  const values = createWaterUniformValues(init);
  const uniforms = {} as WaterNodeUniforms;

  for (const name of WATER_UNIFORM_NAMES) {
    if (WATER_TEXTURE_UNIFORM_NAMES.includes(name)) {
      // TextureNode carries `.value`, so a later `uniforms.sweHeightMap.value = tex`
      // from the render loop rebinds the sampler without rebuilding the graph.
      uniforms[name] = texture((values[name] as THREE.Texture | null) ?? BLACK_PIXEL);
      continue;
    }
    uniforms[name] = uniform(values[name] as never);
  }

  return uniforms;
}

/**
 * Displacement field — port of `getDisplacement()` in FlowingWater.tsx.
 * `p` is local XZ, `fb` the flow bias.
 */
function buildDisplacement(u: WaterNodeUniforms) {
  const time = nd(u.time);
  const flowSpeed = nd(u.flowSpeed);
  const isPond = nd(u.isPond);
  const weatherRipple = nd(u.weatherRipple);
  const cameraHeight = nd(u.cameraHeight);
  const vehiclePos = nd(u.vehiclePos);
  const vehicleVelocity = nd(u.vehicleVelocity);

  return Fn(([p, fb]: [ReturnType<typeof vec2>, ReturnType<typeof vec2>]) => {
    const effFlow = flowSpeed;
    const scale = float(WATER_SHADER.DISPLACEMENT_STRENGTH)
      .mul(float(0.6).add(effFlow.mul(0.4)))
      .mul(mix(float(1), float(WATER_SHADER.POND_CALM_MULTIPLIER * 0.5), isPond));

    const d1 = normalize(vec2(fb.x.mul(0.3), float(-1)));
    const swell1 = sin(dot(p, d1).mul(0.4).add(time.mul(effFlow).mul(0.8))).mul(0.6);

    const d2 = normalize(vec2(fb.x.mul(0.5).add(0.2), float(-1)));
    const swell2 = sin(
      dot(p, d2).mul(0.55).add(time.mul(effFlow).mul(1.1)).add(1.57),
    ).mul(0.4);

    const detail = fbm3(
      p.mul(1.5).add(vec2(time.mul(effFlow).mul(0.2), time.mul(effFlow).mul(-0.3))),
    ).mul(0.25);

    const choppiness = clamp(effFlow.sub(0.8), float(0), float(2.5));
    const chop = fbm3(
      p.mul(4).add(vec2(time.mul(effFlow).mul(-0.6), time.mul(effFlow).mul(0.45))),
    )
      .mul(0.18)
      .mul(choppiness)
      .mul(mix(float(1), float(WATER_SHADER.POND_CALM_MULTIPLIER * 0.3), isPond));

    const ripple = sin(p.x.mul(8 * WATER_SHADER.RIPPLE_SCALE).add(time.mul(4)))
      .mul(cos(p.y.mul(7.5 * WATER_SHADER.RIPPLE_SCALE).add(time.mul(3.5))))
      .mul(weatherRipple)
      .mul(0.08);

    const pondRipple = sin(length(p.sub(vehiclePos.xz)).mul(1.4).sub(time.mul(1.5)))
      .mul(0.04)
      .mul(isPond);

    const heightDiff = abs(cameraHeight.sub(0.5));
    const heightProx = float(1).sub(smoothstep(float(0), float(6), heightDiff));
    const proximityScale = float(1).add(heightProx.mul(0.35));

    const distToVehicle = length(p.sub(vehiclePos.xz));
    const vehicleProx = float(1).sub(smoothstep(float(0), float(9), distToVehicle));
    const velLen = length(vehicleVelocity);
    const vehicleTurb = fbm3(p.mul(3).add(vec2(time.mul(1.7), time.mul(-1.3))))
      .mul(vehicleProx)
      .mul(clamp(velLen, float(0), float(45)))
      .mul(0.012);

    return swell1
      .add(swell2)
      .add(detail)
      .add(chop)
      .add(ripple)
      .add(pondRipple)
      .mul(scale)
      .mul(proximityScale)
      .add(vehicleTurb);
  });
}

/** Port of `sampleSWEDisplacement()` — branchless, bounds handled by masks. */
function buildSweSampler(u: WaterNodeUniforms) {
  const sweOrigin = nd(u.sweOrigin);
  const sweCellSize = nd(u.sweCellSize);
  const sweGridSize = nd(u.sweGridSize);
  const sweMeanDepth = nd(u.sweMeanDepth);
  const sweDisplacementScale = nd(u.sweDisplacementScale);
  const sweEnabled = nd(u.sweEnabled);
  const sweHeightMap = nd(u.sweHeightMap);

  return Fn(([worldXZ]: [ReturnType<typeof vec2>]) => {
    const gridSpan = sweGridSize.mul(sweCellSize);
    const local = worldXZ.sub(sweOrigin).div(gridSpan);

    // GLSL early-returns outside [0,1]; here the same test becomes a 0/1 mask so
    // the fragment stays branchless.
    const inside = step(float(0), local.x)
      .mul(step(local.x, float(1)))
      .mul(step(float(0), local.y))
      .mul(step(local.y, float(1)));

    // `.sample()` rebinds the sampler coordinate (r172 renamed it from `.uv()`).
    const h = sweHeightMap.sample(clamp(local, vec2(0, 0), vec2(1, 1))).r;

    return h
      .sub(sweMeanDepth)
      .mul(sweDisplacementScale)
      .mul(inside)
      .mul(step(float(0.5), sweEnabled));
  });
}

/**
 * Flow bias — the GLSL `USE_FLOWMAP` define as a build-time variant.
 * Without a flow map both stages fall back to the same `vec2(sin(time*0.1), -1)`.
 */
function buildFlowBias(u: WaterNodeUniforms, useFlowMap: boolean) {
  if (!useFlowMap) {
    return vec2(sin(nd(u.time).mul(0.1)), float(-1));
  }
  return nd(u.flowMap).sample(uv().mul(0.5)).rg.mul(2).sub(1);
}

/**
 * Vertex-stage surface solve. Everything here is evaluated once per vertex and
 * interpolated — the fragment stage reads the varyings, never the field.
 */
function buildSurfaceVaryings(u: WaterNodeUniforms, flowBias: ReturnType<typeof vec2>) {
  const displacement = buildDisplacement(u);
  const sweSample = buildSweSampler(u);
  const time = nd(u.time);
  const flowSpeed = nd(u.flowSpeed);

  // GLSL takes displacement in LOCAL XZ and the SWE field in WORLD XZ, both from
  // the undisplaced vertex — `positionGeometry`, not the already-assigned
  // `positionLocal`, so the sample sites cannot drift with the displacement.
  const localXZ = positionGeometry.xz;
  const worldPosVertex = modelWorldMatrix.mul(vec4(positionGeometry, float(1))).xyz;
  const worldXZVertex = worldPosVertex.xz;

  const sampleAt = (offset: ReturnType<typeof vec2>) =>
    displacement(localXZ.add(offset), flowBias).add(sweSample(worldXZVertex.add(offset)));

  // --- surface normal from the displacement gradient (GLSL 4-sample cross) ---
  const h = float(0.08);
  const dCenter = sampleAt(vec2(0, 0));
  const dL = sampleAt(vec2(h.negate(), float(0)));
  const dR = sampleAt(vec2(h, float(0)));
  const dD = sampleAt(vec2(float(0), h.negate()));
  const dU = sampleAt(vec2(float(0), h));
  const tangentX = normalize(vec3(h.mul(2), dR.sub(dL), float(0)));
  const tangentZ = normalize(vec3(float(0), dU.sub(dD), h.mul(2)));
  const surfaceNormal = normalize(cross(tangentZ, tangentX));

  // vCurrent — swell magnitude, mirrors the GLSL vertex stage (local XZ).
  const scale = float(WATER_SHADER.DISPLACEMENT_STRENGTH).mul(
    float(0.6).add(flowSpeed.mul(0.4)),
  );
  const c1 = normalize(vec2(flowBias.x.mul(0.3), float(-1)));
  const s1 = sin(dot(localXZ, c1).mul(0.4).add(time.mul(flowSpeed).mul(0.8))).mul(0.6);
  const c2 = normalize(vec2(flowBias.x.mul(0.5).add(0.2), float(-1)));
  const s2 = sin(dot(localXZ, c2).mul(0.55).add(time.mul(flowSpeed).mul(1.1)).add(1.57)).mul(0.4);
  const current = clamp(abs(s1).add(abs(s2)).mul(scale), float(0), float(1));

  return {
    /** Total Y displacement at this vertex — drives `positionNode`. */
    displacedY: dCenter,
    vNormal: varying(surfaceNormal, 'vWaterNormal'),
    vWave: varying(clamp(dCenter.mul(2).add(0.5), float(0), float(1)), 'vWaterWave'),
    vCurrent: varying(current, 'vWaterCurrent'),
    /** Undisplaced world position, exactly like the GLSL `vWorldPos`. */
    vWorldPos: varying(worldPosVertex, 'vWaterWorldPos'),
    vViewDir: varying(normalize(cameraPosition.sub(worldPosVertex)), 'vWaterViewDir'),
  };
}

type SurfaceVaryings = ReturnType<typeof buildSurfaceVaryings>;

function buildColorNode(
  u: WaterNodeUniforms,
  surface: SurfaceVaryings,
  flowBias: ReturnType<typeof vec2>,
) {
  const time = nd(u.time);
  const flowSpeed = nd(u.flowSpeed);
  const isPond = nd(u.isPond);
  const wetness = nd(u.wetness);
  const slushiness = nd(u.slushiness);
  const timeOfDay = nd(u.timeOfDay);
  const bioLuminescence = nd(u.bioLuminescence);
  const vortexCenter = nd(u.vortexCenter);
  const vortexRadius = nd(u.vortexRadius);
  const vortexIntensity = nd(u.vortexIntensity);

  const worldPos = surface.vWorldPos;
  const worldXZ = worldPos.xz;

  const normalN = normalize(surface.vNormal);
  const viewDirN = normalize(surface.vViewDir);
  const wave = surface.vWave;
  const current = surface.vCurrent;

  // --- vortex swirl ---
  const vortexDelta = worldXZ.sub(vortexCenter.xz);
  const vortexDist = length(vortexDelta);
  const vortexMask = float(1)
    .sub(smoothstep(float(0), max(vortexRadius, float(0.01)), vortexDist))
    .mul(vortexIntensity);
  const vortexTangent = normalize(vec2(vortexDelta.y.negate(), vortexDelta.x).add(0.0001));
  const vortexUvOffset = vortexTangent.mul(time).mul(flowSpeed).mul(0.12).mul(vortexMask);

  // --- scrolling foam streaks ---
  const rapidsBoost = max(float(1), flowSpeed.div(WATER_SHADER.RAPIDS_FOAM_SPEED_MULT));
  const streakUv = worldXZ
    .mul(vec2(0.15, 0.6))
    .mul(WATER_SHADER.FLOW_INFLUENCE)
    .add(
      vec2(
        time.mul(flowSpeed).mul(0.05).mul(flowBias.x).mul(rapidsBoost),
        time.mul(flowSpeed).mul(-0.15).mul(rapidsBoost),
      ),
    )
    .add(vortexUvOffset);
  const streakNoise = fbm3(streakUv);
  const streakUv2 = worldXZ
    .mul(vec2(0.12, 0.5))
    .mul(WATER_SHADER.FLOW_INFLUENCE)
    .add(
      vec2(
        time.mul(flowSpeed).mul(-0.04).mul(rapidsBoost),
        time.mul(flowSpeed).mul(-0.19).mul(rapidsBoost),
      ),
    )
    .add(vortexUvOffset.mul(0.7));
  const streakNoise2 = fbm2(streakUv2);
  const foamStreakBase = smoothstep(
    float(0.45),
    float(0.75),
    max(streakNoise, streakNoise2.mul(0.85)),
  ).mul(WATER_SHADER.FOAM_INTENSITY);
  const foamStreakVortex = vortexMask.mul(
    smoothstep(float(0.15), float(0.55), vortexDist.div(max(vortexRadius, float(0.01)))).mul(0.45),
  );

  // --- edge foam ---
  const edgeDist = abs(uv().x.sub(0.5));
  const normalSteep = float(1).sub(abs(dot(normalN, vec3(0, 1, 0))));
  const edgeFoamBase = smoothstep(float(WATER_SHADER.EDGE_FOAM_WIDTH), float(0), edgeDist)
    .mul(float(0.6).add(streakNoise.mul(0.4)))
    .mul(float(1).add(normalSteep.mul(3.5)))
    .mul(float(1).add(rapidsBoost.sub(1).mul(0.5)));

  // --- standing eddy foam + bubble lines ---
  const eddyMask = fbm3(worldXZ.mul(0.09).add(vec2(7.3, -2.1)));
  const eddyFoamBase = smoothstep(float(0.5), float(0.68), eddyMask)
    .mul(float(1).sub(current))
    .mul(WATER_SHADER.EDDY_FOAM_INTENSITY);
  const bubbleUv = worldXZ
    .mul(vec2(1.4, 0.35))
    .add(vec2(time.mul(flowSpeed).mul(0.12), time.mul(flowSpeed).mul(-0.07)));
  const bubbleLinesBase = smoothstep(float(0.93), float(0.985), fbm2(bubbleUv)).mul(
    float(0.5).add(eddyMask.mul(0.5)),
  );

  // Glassy pond/delta water suppresses the rough-water foam terms.
  const pondCalm = mix(float(1), float(WATER_SHADER.POND_CALM_MULTIPLIER), isPond);
  const foamStreak = foamStreakBase.add(foamStreakVortex).mul(pondCalm);
  const edgeFoam = edgeFoamBase.mul(mix(float(1), float(0.6), isPond));
  const eddyFoam = eddyFoamBase.mul(pondCalm);
  const bubbleLines = bubbleLinesBase.mul(pondCalm);

  // --- vehicle wake ---
  const vehiclePos = nd(u.vehiclePos);
  const vehicleVelocity = nd(u.vehicleVelocity);
  const toVehicle = vehiclePos.sub(worldPos);
  const velLen = length(vehicleVelocity);
  const velDir = mix(
    vec3(0, 0, -1),
    normalize(vehicleVelocity.add(0.00001)),
    step(float(0.001), velLen),
  );
  const behind = dot(toVehicle, velDir.negate());
  const sideways = length(toVehicle.add(velDir.mul(behind)));
  const wakeMask = smoothstep(float(WATER_SHADER.WAKE_WIDTH), float(0), sideways)
    .mul(smoothstep(float(WATER_SHADER.WAKE_LENGTH), float(0), behind))
    .mul(smoothstep(float(0), float(1), behind));
  const wakeFoam = wakeMask
    .mul(float(0.4).add(streakNoise.mul(0.3)))
    .mul(WATER_SHADER.FOAM_INTENSITY)
    .mul(pondCalm);
  const wakeDisplacement = wakeMask.mul(wave).mul(0.15);

  const foam = clamp(
    clamp(foamStreak.add(edgeFoam).add(wakeFoam).add(eddyFoam).add(bubbleLines), float(0), float(1)).mul(
      float(1).add(slushiness.mul(0.85)),
    ),
    float(0),
    float(1),
  );

  // --- base water color ---
  const depthFactor = clamp(float(1).sub(edgeDist.mul(2)), float(0), float(1));
  const shallow = float(1).sub(depthFactor);
  const waterColor = nd(u.waterColor);
  const deepColor = nd(u.deepColor);
  const foamColor = nd(u.foamColor);
  const edgeHighlight = nd(u.edgeHighlight);
  const baseWater = mix(waterColor, deepColor, depthFactor.mul(float(0.45).add(current.mul(0.18))));

  let fresnel = pow(float(1).sub(clamp(dot(normalN, viewDirN), float(0), float(1))), float(2.5));
  fresnel = fresnel.mul(float(1).add(wetness.mul(WATER_SHADER.WETNESS_REFLECT_BOOST)));
  fresnel = mix(fresnel, pow(fresnel, float(0.5)), isPond);

  // --- caustics (refraction-warped dual fbm) ---
  const viewAngle = clamp(dot(normalN, viewDirN), float(0), float(1));
  const refractOffset = normalN.xz.mul(float(1).sub(viewAngle)).mul(1.6);
  const causticsUv1 = worldXZ
    .mul(0.4)
    .add(refractOffset)
    .add(vec2(time.mul(flowSpeed).mul(0.1), time.mul(flowSpeed).mul(-0.2)));
  const causticsUv2 = worldXZ
    .mul(0.35)
    .add(refractOffset)
    .add(vec2(time.mul(flowSpeed).mul(-0.15), time.mul(flowSpeed).mul(0.1)));
  const causticsVal = fbm2(causticsUv1)
    .add(fbm2(causticsUv2))
    .mul(WATER_SHADER.CAUSTICS_BRIGHTNESS)
    .mul(float(0.4).add(shallow.mul(1.6)));
  const litWater = baseWater.add(edgeHighlight.mul(causticsVal).mul(0.18).mul(depthFactor));

  let col = mix(litWater, foamColor, foam);

  // --- planar reflection from the WaterReflection RT ---
  // GLSL derives the sample UV from `vReflectionUv` (the clip position of the
  // displaced vertex). Re-projecting the interpolated world position lands on the
  // same fragment and avoids depending on framebuffer-origin conventions, which
  // differ between the WebGL2 and native WebGPU backends.
  const reflectionTexture = nd(u.reflectionTexture);
  const reflectionStrength = nd(u.reflectionStrength);
  const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(worldPos, float(1)));
  const reflectionUv = clipPos.xy
    .div(max(clipPos.w, float(0.0001)))
    .mul(0.5)
    .add(0.5)
    .add(normalN.xz.mul(0.015));
  const reflection = reflectionTexture.sample(
    clamp(reflectionUv, vec2(0.001, 0.001), vec2(0.999, 0.999)),
  ).rgb;
  // GLSL guards with `if (reflectionStrength > 0.001)`; the mask keeps the same
  // cutoff without a branch (strength already scales the mix).
  const reflectionMix = fresnel
    .mul(reflectionStrength)
    .mul(float(1).sub(foam.mul(0.55)))
    .mul(step(float(0.001), reflectionStrength));
  col = mix(col, reflection, reflectionMix);

  col = mix(col, edgeHighlight, fresnel.mul(0.22));
  col = col.add(vec3(wakeDisplacement, wakeDisplacement, wakeDisplacement));

  // --- sun/moon specular catch-light ---
  const sunWorldPos = nd(u.sunWorldPos);
  const sunDirN = normalize(sunWorldPos.sub(worldPos));
  const reflectDir = reflect(viewDirN.negate(), normalN);
  const specAngle = max(dot(reflectDir, sunDirN), float(0));
  const specShininess = mix(
    float(WATER_SHADER.SPECULAR_SHININESS),
    float(WATER_SHADER.SPECULAR_SHININESS * 3),
    isPond,
  );
  const specular = pow(specAngle, specShininess).mul(float(1).sub(foam.mul(0.6)));
  col = col.add(
    vec3(1.0, 0.96, 0.85)
      .mul(specular)
      .mul(float(0.7).add(wetness.mul(0.3)))
      .mul(mix(float(1), float(1.6), isPond)),
  );

  // --- weather wetness, glint, bioluminescence, god rays, night dim ---
  col = col.mul(float(1).sub(wetness.mul(WATER_SHADER.WETNESS_DARKEN)));

  const glint = smoothstep(float(0.78), float(0.98), wave)
    .mul(float(0.2).add(current.mul(0.25)))
    .add(streakNoise.mul(float(0.05).add(current.mul(0.12))));
  col = col.add(vec3(glint, glint, glint));

  const bioGlow = bioLuminescence
    .mul(float(1).sub(depthFactor))
    .mul(float(0.6).add(sin(time.mul(3)).mul(0.4)));
  col = col.add(vec3(0.3, 0.8, 1.0).mul(bioGlow).mul(1.8));

  // Canyon god rays: two shifted fbm layers multiplied into tight beams, faded
  // toward the banks so the shafts read as entering from the canyon top-center.
  const sunDir = nd(u.sunDir);
  const godRayStrength = nd(u.godRayStrength);
  const sunXZ = normalize(sunDir.xz.add(vec2(0.001, 0.001)));
  const shaftUv1 = worldXZ.mul(0.055).add(sunXZ.mul(time).mul(0.018));
  const shaftUv2 = worldXZ
    .mul(0.038)
    .sub(sunXZ.mul(time).mul(0.012))
    .add(vec2(0.63, 1.17));
  const shaftPattern = smoothstep(float(0.52), float(0.84), fbm2(shaftUv1)).mul(
    smoothstep(float(0.48), float(0.8), fbm2(shaftUv2)),
  );
  const lateralFade = float(1).sub(smoothstep(float(0), float(10), abs(worldPos.x)));
  col = col.add(
    vec3(1.0, 0.93, 0.72)
      .mul(shaftPattern)
      .mul(godRayStrength)
      .mul(lateralFade)
      .mul(float(1).sub(foam.mul(0.65)))
      .mul(step(float(0.001), godRayStrength)),
  );

  col = col.mul(float(1).sub(timeOfDay.mul(0.4)));

  const alpha = clamp(
    float(0.7)
      .add(wave.mul(0.1))
      .add(foam.mul(0.08))
      .add(current.mul(0.06))
      .add(slushiness.mul(0.06)),
    float(0.62),
    float(0.96),
  );

  return vec4(col, alpha);
}

/**
 * Build the TSL water material. The returned material carries a `uniforms`
 * record with the same keys as the GLSL ShaderMaterial, so FlowingWater's
 * per-frame update loop is backend-agnostic.
 */
export function createWaterNodeMaterial(init: WaterUniformInit): WaterNodeMaterial {
  const uniforms = buildUniformNodes(init);
  // Mirrors the GLSL `USE_FLOWMAP` define, which FlowingWater sets from the same
  // texture. A material is rebuilt when the flow map appears or disappears.
  const flowBias = buildFlowBias(uniforms, init.flowMap != null);
  const surface = buildSurfaceVaryings(uniforms, flowBias);

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }) as WaterNodeMaterial;

  // positionNode is LOCAL space; `surface.displacedY` already carries both the
  // procedural field (local XZ) and the SWE sample (world XZ), exactly as the
  // GLSL vertex stage adds `d + sweD` to `pos.y`.
  material.positionNode = positionLocal.add(
    vec3(float(0), surface.displacedY, float(0)),
  ) as never;

  material.colorNode = buildColorNode(uniforms, surface, flowBias) as never;
  material.uniforms = uniforms;
  material.userData.materialBackend = 'tsl';
  material.userData.waterFlowMapVariant = init.flowMap != null;

  return material;
}

/** True when a material was produced by this module. */
export function isWaterNodeMaterial(material: unknown): material is WaterNodeMaterial {
  return (
    !!material &&
    typeof material === 'object' &&
    (material as { userData?: { materialBackend?: string } }).userData?.materialBackend === 'tsl'
  );
}

/** Minimum float epsilon under which two backend outputs are considered equal. */
export const WATER_PARITY_EPSILON = 1e-3;
