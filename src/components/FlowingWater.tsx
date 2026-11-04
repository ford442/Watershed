// src/components/FlowingWater.tsx
// Water shader overhaul: Gerstner swells, fbm detail, flowMap, vehicle wake, caustics, weather wetness

import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { WATER_LEVEL } from '../constants/game';
import { useShaderLoader } from '../hooks/useShaderLoader';
import { DEFAULT_BIOME_ID, getWaterProfile, type BiomeId } from '../configs/biomes';
import { createWaterMaterial } from '../materials/water/createWaterMaterial';
import { resolveMaterialBackend } from '../rendering/materialBackend';
import { WATER_SURFACE_LAYER } from '../rendering/renderLayers';
import { getSkyClock } from '../systems/sky/skyClock';
import {
  createWaterBasicFallback,
  getBlackReflectionFallback,
  isUsableFragmentShader,
  publishWaterMaterialBackend,
  resolveWaterFragmentShader,
  updateFlowingWaterUniforms,
  warnWaterShaderCompileOnce,
  type WaterMaterial,
} from './waterUniforms';
import { WATER_FRAGMENT_GLSL, WATER_VERTEX_GLSL, waterGlslDefines } from './flowingWaterGlsl';

/** Guard flag: FlowingWater samples planar reflectionTexture (XOR with unmounted pass). */
export const FLOWING_WATER_SAMPLES_REFLECTION = true;

/** Water meshes render on WATER_SURFACE_LAYER only — the reflection camera leaves it out. */
const WATER_SURFACE_LAYERS = new THREE.Layers();
WATER_SURFACE_LAYERS.set(WATER_SURFACE_LAYER);

export interface FlowingWaterProps {
  geometry: THREE.BufferGeometry;
  flowSpeed?: number;
  baseColor?: THREE.ColorRepresentation;
  foamColor?: THREE.ColorRepresentation;
  edgeHighlightColor?: THREE.ColorRepresentation;
  shaderId?: string | null;
  onShaderLoad?: (code: string | null, error: string | null) => void;
  biome?: BiomeId | string;
  isNight?: boolean;
  flowMap?: THREE.Texture | null;
  vehiclePos?: THREE.Vector3 | null;
  vehicleVelocity?: THREE.Vector3 | null;
  weatherRipple?: number;
  wetness?: number;
  slushiness?: number;
  waterSurfaceOffset?: number;
  sunWorldPosition?: THREE.Vector3 | null;
  isPond?: boolean;
  vortexCenter?: THREE.Vector3 | null;
  vortexRadius?: number;
  vortexIntensity?: number;
}

export default function FlowingWater({
  geometry,
  flowSpeed = 1.2,
  baseColor,
  foamColor,
  edgeHighlightColor,
  shaderId = null,
  onShaderLoad,
  biome = DEFAULT_BIOME_ID,
  isNight = false,
  flowMap = null,
  vehiclePos = null,
  vehicleVelocity = null,
  weatherRipple = 0,
  wetness = 0,
  slushiness = 0,
  waterSurfaceOffset = 0,
  sunWorldPosition = null,
  isPond = false,
  vortexCenter = null,
  vortexRadius = 10,
  vortexIntensity = 0,
}: FlowingWaterProps) {
  const materialRef = useRef<WaterMaterial | THREE.MeshBasicMaterial | null>(null);
  const { camera } = useThree();
  // Which material implementation to build (#256 path A). Resolved once — the
  // Canvas is remounted when the debug toggle changes it.
  const materialBackend = useMemo(() => resolveMaterialBackend().backend, []);
  // Water renders on its own layer (renderLayers.ts); the main camera sees it.
  useEffect(() => {
    camera.layers.enable(WATER_SURFACE_LAYER);
  }, [camera]);

  const water = getWaterProfile(biome);
  const effectiveWaterColor = baseColor || water.waterColor;
  const effectiveFoamColor = foamColor || water.foamColor;
  const effectiveEdgeColor = edgeHighlightColor || water.edgeHighlight;
  const effectiveFlowSpeed = flowSpeed * water.flowMultiplier * (1.0 + slushiness * 0.25);
  const effectiveFlowMap = flowMap;

  // Built-in GLSL sources (flowingWaterGlsl.ts): module constants, so the boot
  // shader warm-up compiles exactly this program.
  const builtinVertexShader = WATER_VERTEX_GLSL;
  const builtinFragmentShader = WATER_FRAGMENT_GLSL;

  // Load dynamic shader
  const effectiveShaderId = shaderId || water.shaderId;

  const { code: dynamicShaderCode, loading: shaderLoading, error: shaderError } =
    useShaderLoader(effectiveShaderId ?? null, builtinFragmentShader);

  useEffect(() => {
    if (onShaderLoad && !shaderLoading) {
      onShaderLoad(dynamicShaderCode, shaderError);
    }
  }, [dynamicShaderCode, shaderError, shaderLoading, onShaderLoad]);

  const fragmentShader = useMemo(
    () => resolveWaterFragmentShader(dynamicShaderCode, builtinFragmentShader),
    [builtinFragmentShader, dynamicShaderCode],
  );

  // Create material with upgraded shader + defines
  const material = useMemo(() => {
    if (!isUsableFragmentShader(fragmentShader)) {
      return createWaterBasicFallback(effectiveWaterColor);
    }

    try {
      const deepColor = new THREE.Color(effectiveWaterColor).multiplyScalar(0.55);

      const defines = waterGlslDefines(!!effectiveFlowMap);

      const { material: mat, backend: activeBackend, fallbackReason } = createWaterMaterial({
        backend: materialBackend,
        init: {
          flowSpeed: effectiveFlowSpeed,
          waterColor: effectiveWaterColor,
          deepColor,
          foamColor: effectiveFoamColor,
          edgeHighlight: effectiveEdgeColor,
          weatherRipple,
          wetness,
          slushiness,
          isPond,
          vehiclePos,
          vehicleVelocity,
          flowMap: effectiveFlowMap,
          sunWorldPosition,
          reflectionFallback: getBlackReflectionFallback(),
          vortexCenter,
          vortexRadius,
          vortexIntensity,
        },
        glsl: {
          vertexShader: builtinVertexShader,
          fragmentShader,
          defines,
        },
      });
      publishWaterMaterialBackend(activeBackend, fallbackReason);

      // Expose flow field sampler
      mat.userData.waterFlowField = {
        waterLevel: WATER_LEVEL,
        flowSpeed: effectiveFlowSpeed,
        sampleAt: (position: THREE.Vector3, time: number) => {
          const x = position.x * 0.35;
          const z = position.z * 0.28 - time * effectiveFlowSpeed * 0.15;
          return {
            direction: new THREE.Vector3(Math.sin(z) * 0.25, 0, -1).normalize(),
            speed: effectiveFlowSpeed * (1 + Math.sin(x + z) * 0.12),
          };
        },
      };

      materialRef.current = mat as WaterMaterial;
      return mat;
    } catch (e: unknown) {
      warnWaterShaderCompileOnce(e);
      return createWaterBasicFallback(effectiveWaterColor);
    }
  }, [
    effectiveWaterColor,
    effectiveFoamColor,
    effectiveEdgeColor,
    effectiveFlowSpeed,
    fragmentShader,
    effectiveFlowMap,
    slushiness,
    builtinVertexShader,
    materialBackend,
    weatherRipple,
    wetness,
    isPond,
    vehiclePos,
    vehicleVelocity,
    sunWorldPosition,
    vortexCenter,
    vortexRadius,
    vortexIntensity,
  ]);

  // Update uniforms with strong guards
  useFrame((state, delta) => {
    const sky = getSkyClock();
    updateFlowingWaterUniforms(materialRef.current, {
      elapsedTime: state.clock.elapsedTime,
      delta,
      cameraY: camera.position.y,
      biome,
      isNight,
      flowMap,
      vehiclePos,
      vehicleVelocity,
      weatherRipple,
      wetness,
      slushiness,
      sunWorldPosition,
      sunDirection: sky.sun,
      nightFactor: sky.factors.night,
      isPond,
      vortexCenter,
      vortexRadius,
      vortexIntensity,
    });
  });

  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        position={[0, -waterSurfaceOffset, 0]}
        userData={{ isWaterSurface: true }}
        layers={WATER_SURFACE_LAYERS}
      />
      {shaderLoading && effectiveShaderId && (
        <mesh
          geometry={geometry}
          position={[0, -waterSurfaceOffset, 0]}
          userData={{ isWaterSurface: true }}
          layers={WATER_SURFACE_LAYERS}
        >
          <meshBasicMaterial color="#1a6b8a" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}
