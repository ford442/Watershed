import React, { useMemo, useRef } from 'react';
import { EffectComposer, Bloom, Vignette, ChromaticAberration, SSAO, HueSaturation } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';

/**
 * PostProcessingEffects - Cinematic post-processing stack
 * 
 * Effects:
 * - Bloom: Glow on bright areas (water, sun, particles)
 * - Vignette: Dark edges for canyon tunnel feel
 * - Chromatic Aberration: Speed-scaled color fringing (E3)
 * - HueSaturation: Speed-based desaturation (E3)
 * - SSAO: Screen-space ambient occlusion (high quality only)
 * 
 * Requirements:
 * E1: Bloom, Vignette, SSAO
 * E3: Motion blur (simulated), Desaturation, Chromatic aberration scaling
 */
export function PostProcessingEffects({
  // Quality level determines which effects are enabled
  quality = 'high',
  
  // Velocity for speed-triggered effects (E3)
  velocity = 0,
  maxVelocity = 25,
  
  // Bloom settings (E1 spec)
  bloomIntensity = 0.5,
  bloomThreshold = 0.8,
  bloomSmoothing = 0.025,
  bloomRadius = 0.5,
  
  // Vignette settings (E1 spec)
  vignetteOffset = 0.35,
  vignetteDarkness = 0.5,
  
  // Chromatic aberration base (E3: scales with velocity)
  chromaticBaseOffset = 0.001,
  chromaticMaxOffset = 0.002,
  
  // SSAO settings (E1 spec)
  ssaoIntensity = 1.2,
  ssaoRadius = 5,
  ssaoBias = 0.5,
}) {
  // Ref for smooth interpolation
  const smoothedValues = useRef({
    chromaticOffset: chromaticBaseOffset,
    saturation: 1.0,
    vignetteBoost: 0,
  });
  
  // Enable SSAO only at high quality (E1 requirement)
  const enableSSAO = quality === 'high' || quality === 'ultra';
  const enableSpeedEffects = quality !== 'low' && quality !== 'minimal';
  
  // Calculate speed factor (0-1)
  const speedFactor = Math.min(1, velocity / maxVelocity);
  
  // E3: Chromatic aberration intensity scales with velocity
  // Base 0.001 + 0.001 * (v / maxV)
  const targetChromaticOffset = chromaticBaseOffset + (chromaticMaxOffset - chromaticBaseOffset) * speedFactor;
  
  // E3: Desaturation increases with velocity
  // v < 5: 0%, v = 15: 30%, v > 25: 50%
  let targetSaturation = 1.0;
  if (velocity > 5) {
    if (velocity <= 15) {
      // 5-15 m/s: 0% to 30% desaturation
      const t = (velocity - 5) / 10;
      targetSaturation = 1.0 - (t * 0.3);
    } else if (velocity <= 25) {
      // 15-25 m/s: 30% to 50% desaturation
      const t = (velocity - 15) / 10;
      targetSaturation = 0.7 - (t * 0.2);
    } else {
      // > 25 m/s: 50% desaturation
      targetSaturation = 0.5;
    }
  }
  
  // E3: Vignette boost at max velocity (brief flare effect)
  const targetVignetteBoost = velocity > maxVelocity * 0.9 ? 0.3 : 0;
  
  // Smooth all transitions with 0.3s lerp (E3 requirement)
  const lerpFactor = 0.3; // Approximate for 0.3s at 60fps
  smoothedValues.current.chromaticOffset += (targetChromaticOffset - smoothedValues.current.chromaticOffset) * lerpFactor;
  smoothedValues.current.saturation += (targetSaturation - smoothedValues.current.saturation) * lerpFactor;
  smoothedValues.current.vignetteBoost += (targetVignetteBoost - smoothedValues.current.vignetteBoost) * lerpFactor;
  
  // Memoize effect parameters
  const bloomParams = useMemo(() => ({
    intensity: bloomIntensity,
    threshold: bloomThreshold,
    smoothing: bloomSmoothing,
    radius: bloomRadius,
  }), [bloomIntensity, bloomThreshold, bloomSmoothing, bloomRadius]);

  const vignetteParams = useMemo(() => ({
    offset: vignetteOffset,
    darkness: vignetteDarkness + smoothedValues.current.vignetteBoost,
  }), [vignetteOffset, vignetteDarkness, smoothedValues.current.vignetteBoost]);

  const chromaticParams = useMemo(() => ({
    offset: new THREE.Vector2(smoothedValues.current.chromaticOffset, smoothedValues.current.chromaticOffset),
    blendFunction: BlendFunction.NORMAL,
  }), [smoothedValues.current.chromaticOffset]);

  const ssaoParams = useMemo(() => ({
    intensity: ssaoIntensity,
    radius: ssaoRadius,
    bias: ssaoBias,
    distance: 20,
  }), [ssaoIntensity, ssaoRadius, ssaoBias]);

  const hueSaturationParams = useMemo(() => ({
    saturation: smoothedValues.current.saturation,
    hue: 0,
  }), [smoothedValues.current.saturation]);

  return (
    <EffectComposer
      multisampling={quality === 'low' ? 2 : 4}
      enabled={true}
    >
      {/* SSAO - Ambient occlusion for depth (high quality only) */}
      {enableSSAO && (
        <SSAO
          {...ssaoParams}
          samples={16}
          rings={4}
          distanceThreshold={1.0}
          distanceFalloff={0.25}
          rangeThreshold={0.5}
          rangeFalloff={0.1}
          luminanceInfluence={0.4}
          color={new THREE.Color('#000000')}
        />
      )}
      
      {/* HueSaturation - Speed-based desaturation (E3) */}
      {enableSpeedEffects && (
        <HueSaturation
          {...hueSaturationParams}
          blendFunction={BlendFunction.NORMAL}
        />
      )}
      
      {/* Bloom - Glow on bright highlights (water, sun) */}
      <Bloom
        {...bloomParams}
        mipmapBlur={quality !== 'low'}
        levels={quality === 'low' ? 3 : 5}
      />
      
      {/* Chromatic Aberration - Speed-scaled RGB split (E3) */}
      <ChromaticAberration
        {...chromaticParams}
        radialModulation={true}
        modulationOffset={0.3}
      />
      
      {/* Vignette - Dark edges for cinematic canyon feel */}
      <Vignette
        {...vignetteParams}
        eskil={false}
      />
    </EffectComposer>
  );
}

/**
 * Performance-optimized version for lower-end devices
 * Disables SSAO and speed effects, reduces bloom quality
 */
export function PostProcessingEffectsLow() {
  return (
    <EffectComposer multisampling={2} enabled={true}>
      <Bloom
        intensity={0.4}
        threshold={0.8}
        smoothing={0.05}
        radius={0.3}
        mipmapBlur={false}
        levels={3}
      />
      <Vignette
        offset={0.4}
        darkness={0.5}
      />
    </EffectComposer>
  );
}

/**
 * Minimal post-processing for lowest-end devices
 * Bloom and vignette only, no multisampling
 */
export function PostProcessingEffectsMinimal() {
  return (
    <EffectComposer multisampling={0} enabled={true}>
      <Bloom
        intensity={0.3}
        threshold={0.85}
        smoothing={0.1}
        radius={0.2}
        mipmapBlur={false}
        levels={2}
      />
      <Vignette
        offset={0.5}
        darkness={0.4}
      />
    </EffectComposer>
  );
}

export default PostProcessingEffects;
