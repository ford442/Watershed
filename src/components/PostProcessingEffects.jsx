import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
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

  // Velocity ref for speed-triggered effects (E3)
  velocityRef,

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

  // Boost visual spike state
  const boostRef = useRef({ active: 0, intensity: 0 });

  useEffect(() => {
    const onBoost = (e) => {
      const detail = e.detail || {};
      boostRef.current.active = detail.duration ?? 0.8;
      boostRef.current.intensity = detail.intensity ?? 1.5;
    };
    window.addEventListener('boost-triggered', onBoost);
    return () => window.removeEventListener('boost-triggered', onBoost);
  }, []);

  // Enable SSAO only at high quality (E1 requirement)
  const enableSSAO = quality === 'high' || quality === 'ultra';
  const enableSpeedEffects = quality !== 'low' && quality !== 'minimal';

  // Dummy state to trigger re-render after useFrame updates refs
  const [, setTick] = useState(0);

  useFrame((state, delta) => {
    // Decay boost spike using real delta time
    boostRef.current.active = Math.max(0, boostRef.current.active - delta * 1.2);
    const boostScale = boostRef.current.active > 0 ? boostRef.current.intensity : 0;

    // Read velocity from ref (avoids per-frame parent re-renders)
    const velocity = velocityRef?.current ?? 0;
    const speedFactor = Math.min(1, velocity / 25);

    // E3: Chromatic aberration intensity scales with velocity
    const targetChromaticOffset = chromaticBaseOffset + (chromaticMaxOffset - chromaticBaseOffset) * speedFactor;

    // E3: Desaturation increases with velocity
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
    const targetVignetteBoost = velocity > 25 * 0.9 ? 0.3 : 0;

    const targetChromaticWithBoost = targetChromaticOffset + boostScale * 0.0025;
    const targetSaturationWithBoost = Math.min(1, targetSaturation + boostScale * 0.15);
    const targetVignetteWithBoost = targetVignetteBoost + boostScale * 0.25;

    // Smooth transitions with delta-time-correct lerp (~0.3s time constant)
    const t = 1 - Math.exp(-delta * 10);
    smoothedValues.current.chromaticOffset += (targetChromaticWithBoost - smoothedValues.current.chromaticOffset) * t;
    smoothedValues.current.saturation += (targetSaturationWithBoost - smoothedValues.current.saturation) * t;
    smoothedValues.current.vignetteBoost += (targetVignetteWithBoost - smoothedValues.current.vignetteBoost) * t;

    // Trigger re-render so effect components receive updated props
    setTick(v => v + 1);
  });

  const boostScale = boostRef.current.active > 0 ? boostRef.current.intensity : 0;

  // Memoize effect parameters
  const bloomParams = useMemo(() => ({
    intensity: bloomIntensity + boostScale * 0.4,
    threshold: Math.max(0.2, bloomThreshold - boostScale * 0.15),
    smoothing: bloomSmoothing,
    radius: bloomRadius + boostScale * 0.2,
  }), [bloomIntensity, bloomThreshold, bloomSmoothing, bloomRadius, boostScale]);

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
      {/* SSAO - Ambient occlusion for depth (ultra quality only) */}
      {quality === 'ultra' && (
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
