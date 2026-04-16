// src/components/FlowingWater.jsx
// Water shader overhaul: Gerstner swells, fbm detail, flowMap, vehicle wake, caustics, weather wetness

import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SHADERS, WATER_LEVEL, WATER_SHADER } from '../constants/game';
import { useShaderLoader } from '../hooks/useShaderLoader';
import { BIOMES } from '../constants/biomes';

const isUsableFragmentShader = (source) => {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return false;
  }
  return source.includes('void main') && source.includes('gl_FragColor');
};

export default function FlowingWater({
  geometry,
  flowSpeed = 1.2,
  baseColor,
  foamColor,
  edgeHighlightColor,
  shaderId = null,
  onShaderLoad,
  biome = 'river',
  isNight = false,
  flowMap = null,
  vehiclePos = null,
  vehicleVelocity = null,
  weatherRipple = 0,
  wetness = 0,
}) {
  const materialRef = useRef(null);
  const { camera } = useThree();

  const biomeData = BIOMES[biome] || BIOMES.river;
  const effectiveWaterColor = baseColor || biomeData.waterColor;
  const effectiveFoamColor = foamColor || biomeData.foamColor;
  const effectiveEdgeColor = edgeHighlightColor || biomeData.edgeHighlight;
  const effectiveFlowSpeed = flowSpeed * (biomeData.flowMultiplier || 1.0);

  // Shared noise helpers for GLSL
  const noiseHelpers = useMemo(() => `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm3(vec2 p) {
      float v = 0.0;
      v += noise(p) * 0.50;
      p = p * 2.1 + vec2(1.2, 3.4);
      v += noise(p) * 0.25;
      p = p * 2.1 + vec2(4.5, 2.1);
      v += noise(p) * 0.125;
      return v;
    }
    float fbm2(vec2 p) {
      float v = 0.0;
      v += noise(p) * 0.60;
      p = p * 2.2 + vec2(3.1, 1.7);
      v += noise(p) * 0.30;
      return v;
    }
  `, []);

  // Built-in fallback fragment shader with all upgraded features
  const builtinFragmentShader = useMemo(() => `
    uniform float time;
    uniform float flowSpeed;
    uniform vec3 waterColor;
    uniform vec3 deepColor;
    uniform vec3 foamColor;
    uniform vec3 edgeHighlight;
    uniform float bioLuminescence;
    uniform float timeOfDay;
    uniform float weatherRipple;
    uniform float wetness;
    uniform vec3 vehiclePos;
    uniform vec3 vehicleVelocity;
    uniform sampler2D flowMap;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vWave;
    varying float vCurrent;
    varying float vCameraProximity;

    ${noiseHelpers}

    void main() {
      vec2 flowBias = vec2(sin(time * 0.1), -1.0);
      #ifdef USE_FLOWMAP
        flowBias = texture2D(flowMap, vUv * 0.5).rg * 2.0 - 1.0;
      #endif

      // Flow-driven foam streaks on stretched UVs
      vec2 streakUv = vWorldPos.xz * vec2(0.15, 0.6) * FLOW_INFLUENCE
                    + vec2(time * flowSpeed * 0.05 * flowBias.x, -time * flowSpeed * 0.15);
      float streakNoise = fbm3(streakUv);
      float foamStreak = smoothstep(0.45, 0.75, streakNoise) * FOAM_INTENSITY;

      // Sharpened edge foam using EDGE_FOAM_WIDTH and normal test
      float edgeDist = abs(vUv.x - 0.5);
      float edgeFoam = smoothstep(EDGE_FOAM_WIDTH, 0.0, edgeDist) * (0.6 + streakNoise * 0.4);
      float normalSteep = 1.0 - abs(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)));
      edgeFoam *= (1.0 + normalSteep * 2.0);

      // Shader-only vehicle wake
      vec3 toVehicle = vehiclePos - vWorldPos;
      float velLen = length(vehicleVelocity);
      vec3 velDir = velLen > 0.001 ? normalize(vehicleVelocity) : vec3(0.0, 0.0, -1.0);
      float behind = dot(toVehicle, -velDir);
      float sideways = length(toVehicle + velDir * behind);
      float wakeMask = smoothstep(WAKE_WIDTH, 0.0, sideways)
                     * smoothstep(WAKE_LENGTH, 0.0, behind)
                     * smoothstep(0.0, 1.0, behind);
      float wakeFoam = wakeMask * (0.4 + streakNoise * 0.3) * FOAM_INTENSITY;

      float foam = clamp(foamStreak + edgeFoam + wakeFoam, 0.0, 1.0);

      float depthFactor = 1.0 - edgeDist * 2.0;
      depthFactor = clamp(depthFactor, 0.0, 1.0);
      vec3 baseWater = mix(waterColor, deepColor, depthFactor * (0.45 + vCurrent * 0.18));

      float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), 2.5);
      fresnel *= (1.0 + wetness * WETNESS_REFLECT_BOOST);

      // Inline caustics: dual-layer scrolling fbm (2 octaves each = 4 total max)
      vec2 causticsUv1 = vWorldPos.xz * 0.4 + vec2(time * flowSpeed * 0.1, -time * flowSpeed * 0.2);
      vec2 causticsUv2 = vWorldPos.xz * 0.35 + vec2(-time * flowSpeed * 0.15, time * flowSpeed * 0.1);
      float causticsVal = (fbm2(causticsUv1) + fbm2(causticsUv2)) * CAUSTICS_BRIGHTNESS;
      baseWater += edgeHighlight * causticsVal * 0.15 * depthFactor;

      vec3 col = mix(baseWater, foamColor, foam);
      col = mix(col, edgeHighlight, fresnel * 0.22);

      // Weather wetness: darken + reflect boost
      col *= (1.0 - wetness * WETNESS_DARKEN);

      float glint = smoothstep(0.78, 0.98, vWave) * (0.2 + vCurrent * 0.25);
      glint += streakNoise * (0.05 + vCurrent * 0.12);
      col += vec3(glint);

      // Bioluminescence glow for glacial at night
      float bioGlow = bioLuminescence * (1.0 - depthFactor) * (0.6 + sin(time * 3.0) * 0.4);
      col += vec3(0.3, 0.8, 1.0) * bioGlow * 1.8;

      // Darken at night
      float nightDim = 1.0 - (timeOfDay * 0.4);
      col *= nightDim;

      float alpha = 0.7 + vWave * 0.1 + foam * 0.08 + vCurrent * 0.06;
      gl_FragColor = vec4(col, clamp(alpha, 0.62, 0.94));
    }
  `, [noiseHelpers]);

  // Load dynamic shader
  const effectiveShaderId = shaderId || biomeData.shaderId;
  const { code: dynamicShaderCode, loading: shaderLoading, error: shaderError } =
    useShaderLoader(effectiveShaderId, builtinFragmentShader);

  useEffect(() => {
    if (onShaderLoad && !shaderLoading) {
      onShaderLoad(dynamicShaderCode, shaderError);
    }
  }, [dynamicShaderCode, shaderError, shaderLoading, onShaderLoad]);

  const fragmentShader = useMemo(() => {
    const candidateShader = dynamicShaderCode || builtinFragmentShader;
    if (isUsableFragmentShader(candidateShader)) {
      return candidateShader;
    }
    console.warn('[FlowingWater] Invalid fragment shader, using built-in fallback');
    return builtinFragmentShader;
  }, [builtinFragmentShader, dynamicShaderCode]);

  // Create material with upgraded shader + defines
  const material = useMemo(() => {
    if (!isUsableFragmentShader(fragmentShader)) {
      return new THREE.MeshBasicMaterial({
        color: new THREE.Color(effectiveWaterColor),
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
    }

    try {
      const deepColor = new THREE.Color(effectiveWaterColor).multiplyScalar(0.55);

      const defines = {
        DISPLACEMENT_STRENGTH: WATER_SHADER.DISPLACEMENT_STRENGTH.toFixed(3),
        FOAM_INTENSITY: WATER_SHADER.FOAM_INTENSITY.toFixed(3),
        RIPPLE_SCALE: WATER_SHADER.RIPPLE_SCALE.toFixed(3),
        FLOW_INFLUENCE: WATER_SHADER.FLOW_INFLUENCE.toFixed(3),
        CAUSTICS_BRIGHTNESS: WATER_SHADER.CAUSTICS_BRIGHTNESS.toFixed(3),
        WAKE_WIDTH: WATER_SHADER.WAKE_WIDTH.toFixed(3),
        WAKE_LENGTH: WATER_SHADER.WAKE_LENGTH.toFixed(3),
        EDGE_FOAM_WIDTH: WATER_SHADER.EDGE_FOAM_WIDTH.toFixed(3),
        WETNESS_DARKEN: WATER_SHADER.WETNESS_DARKEN.toFixed(3),
        WETNESS_REFLECT_BOOST: WATER_SHADER.WETNESS_REFLECT_BOOST.toFixed(3),
        ...(flowMap ? { USE_FLOWMAP: '1' } : {}),
      };

      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        defines,
        uniforms: {
          time: { value: 0 },
          flowSpeed: { value: effectiveFlowSpeed },
          waterColor: { value: new THREE.Color(effectiveWaterColor) },
          deepColor: { value: deepColor },
          foamColor: { value: new THREE.Color(effectiveFoamColor) },
          edgeHighlight: { value: new THREE.Color(effectiveEdgeColor) },
          bioLuminescence: { value: 0 },
          timeOfDay: { value: 0 },
          weatherRipple: { value: weatherRipple },
          wetness: { value: wetness },
          vehiclePos: { value: vehiclePos ? new THREE.Vector3().copy(vehiclePos) : new THREE.Vector3(99999.0, 99999.0, 99999.0) },
          vehicleVelocity: { value: vehicleVelocity ? new THREE.Vector3().copy(vehicleVelocity) : new THREE.Vector3() },
          flowMap: { value: flowMap || null },
        },
        vertexShader: `
          uniform float time;
          uniform float flowSpeed;
          uniform float weatherRipple;
          uniform sampler2D flowMap;

          varying vec2 vUv;
          varying vec3 vWorldPos;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          varying float vWave;
          varying float vCurrent;
          varying float vCameraProximity;

          ${noiseHelpers}

          float getDisplacement(vec2 p, vec2 fb) {
            float effFlow = flowSpeed;
            float scale = DISPLACEMENT_STRENGTH * (0.6 + flowSpeed * 0.4);

            vec2 d1 = normalize(vec2(fb.x * 0.3, -1.0));
            float swell1 = sin(dot(p, d1) * 0.4 + time * effFlow * 0.8) * 0.6;

            vec2 d2 = normalize(vec2(fb.x * 0.5 + 0.2, -1.0));
            float swell2 = sin(dot(p, d2) * 0.55 + time * effFlow * 1.1 + 1.57) * 0.4;

            float detail = fbm3(p * 1.5 + vec2(time * effFlow * 0.2, -time * effFlow * 0.3)) * 0.25;

            float ripple = sin(p.x * 8.0 * RIPPLE_SCALE + time * 4.0)
                         * cos(p.y * 7.5 * RIPPLE_SCALE + time * 3.5)
                         * weatherRipple * 0.08;

            return (swell1 + swell2 + detail + ripple) * scale;
          }

          void main() {
            vUv = uv;
            vec3 pos = position;

            vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
            vec3 worldPos = worldPos4.xyz;

            float distToCamera = distance(worldPos, cameraPosition);
            vCameraProximity = 1.0 - smoothstep(5.0, 25.0, distToCamera);

            vec2 flowBias = vec2(sin(time * 0.1), -1.0);
            #ifdef USE_FLOWMAP
              flowBias = texture2D(flowMap, uv * 0.5).rg * 2.0 - 1.0;
            #endif

            float d = getDisplacement(pos.xz, flowBias);
            float dX = getDisplacement(pos.xz + vec2(0.05, 0.0), flowBias);
            float dZ = getDisplacement(pos.xz + vec2(0.0, 0.05), flowBias);

            pos.y += d;

            vec3 p0 = vec3(pos.x, d, pos.z);
            vec3 p1 = vec3(pos.x + 0.05, dX, pos.z);
            vec3 p2 = vec3(pos.x, dZ, pos.z + 0.05);
            vec3 newNormal = normalize(cross(p1 - p0, p2 - p0));

            vNormal = normalMatrix * newNormal;
            vViewDir = normalize(cameraPosition - worldPos);
            vWorldPos = worldPos;

            vWave = clamp(d * 2.0 + 0.5, 0.0, 1.0);

            float effFlow = flowSpeed;
            float scale = DISPLACEMENT_STRENGTH * (0.6 + flowSpeed * 0.4);
            vec2 d1 = normalize(vec2(flowBias.x * 0.3, -1.0));
            float s1 = sin(dot(position.xz, d1) * 0.4 + time * effFlow * 0.8) * 0.6;
            vec2 d2 = normalize(vec2(flowBias.x * 0.5 + 0.2, -1.0));
            float s2 = sin(dot(position.xz, d2) * 0.55 + time * effFlow * 1.1 + 1.57) * 0.4;
            vCurrent = clamp((abs(s1) + abs(s2)) * scale, 0.0, 1.0);

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader,
      });

      // Expose flow field sampler
      mat.userData.waterFlowField = {
        waterLevel: WATER_LEVEL,
        flowSpeed: effectiveFlowSpeed,
        sampleAt: (position, time) => {
          const x = position.x * 0.35;
          const z = position.z * 0.28 - time * effectiveFlowSpeed * 0.15;
          return {
            direction: new THREE.Vector3(Math.sin(z) * 0.25, 0, -1).normalize(),
            speed: effectiveFlowSpeed * (1 + Math.sin(x + z) * 0.12),
          };
        },
      };

      materialRef.current = mat;
      return mat;
    } catch (e) {
      console.warn('[FlowingWater] Shader error, falling back to basic material:', e);
      console.error('[FlowingWater] Fragment shader source:', fragmentShader);
      return new THREE.MeshBasicMaterial({
        color: new THREE.Color(effectiveWaterColor),
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
    }
  }, [
    effectiveWaterColor,
    effectiveFoamColor,
    effectiveEdgeColor,
    effectiveFlowSpeed,
    fragmentShader,
    flowMap,
    noiseHelpers,
  ]);

  // Update uniforms with strong guards
  useFrame((state) => {
    const mat = materialRef.current;
    if (!mat?.uniforms?.time) return;

    mat.uniforms.time.value = state.clock.elapsedTime;

    if (mat.uniforms.vehiclePos && vehiclePos) {
      mat.uniforms.vehiclePos.value.copy(vehiclePos);
    } else if (mat.uniforms.vehiclePos) {
      mat.uniforms.vehiclePos.value.set(99999.0, 99999.0, 99999.0);
    }
    if (mat.uniforms.vehicleVelocity && vehicleVelocity) {
      mat.uniforms.vehicleVelocity.value.copy(vehicleVelocity);
    } else if (mat.uniforms.vehicleVelocity) {
      mat.uniforms.vehicleVelocity.value.set(0.0, 0.0, 0.0);
    }
    if (mat.uniforms.weatherRipple) {
      mat.uniforms.weatherRipple.value = weatherRipple;
    }
    if (mat.uniforms.wetness) {
      mat.uniforms.wetness.value = wetness;
    }
    if (mat.uniforms.flowMap) {
      mat.uniforms.flowMap.value = flowMap || null;
    }

    if (mat.uniforms.bioLuminescence) {
      const isGlacial = biome === 'glacial';
      mat.uniforms.bioLuminescence.value = (isNight && isGlacial) ? 1.0 : 0.0;
    }
    if (mat.uniforms.timeOfDay) {
      mat.uniforms.timeOfDay.value = isNight ? 1.0 : 0.0;
    }
  });

  return (
    <>
      <mesh geometry={geometry} material={material} />
      {shaderLoading && effectiveShaderId && (
        <mesh geometry={geometry}>
          <meshBasicMaterial color="#1a6b8a" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}
