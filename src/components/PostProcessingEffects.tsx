/**
 * PostProcessingEffects - Cinematic post-processing using @react-three/postprocessing
 * 
 * Implements:
 * - Bloom: Bright water highlights and sun reflections
 * - Vignette: Canyon tunnel feeling, darkens edges
 * - SSAO: Ambient occlusion in canyon crevices
 */

import React, { useMemo } from 'react';
import { EffectComposer, Bloom, Vignette, SSAO } from '@react-three/postprocessing';
import { useThree } from '@react-three/fiber';

interface PostProcessingEffectsProps {
  // Bloom settings
  bloomIntensity?: number;
  bloomThreshold?: number;
  bloomSmoothing?: number;
  
  // Vignette settings
  vignetteOffset?: number;
  vignetteDarkness?: number;
  
  // SSAO settings
  ssaoIntensity?: number;
  ssaoRadius?: number;
}

/**
 * PostProcessingEffects - R3F post-processing composer
 */
export const PostProcessingEffects: React.FC<PostProcessingEffectsProps> = ({
  // Bloom defaults tuned for water highlights
  bloomIntensity = 0.6,
  bloomThreshold = 0.75,
  bloomSmoothing = 0.4,
  
  // Vignette defaults for canyon tunnel feeling
  vignetteOffset = 0.35,
  vignetteDarkness = 0.6,
  
  // SSAO defaults for crevice shadows
  ssaoIntensity = 1.2,
  ssaoRadius = 0.8,
}) => {
  const { viewport } = useThree();
  
  // Memoize effect settings to prevent unnecessary re-renders
  const bloomSettings = useMemo(() => ({
    intensity: bloomIntensity,
    threshold: bloomThreshold,
    smoothing: bloomSmoothing,
    luminanceThreshold: bloomThreshold,
    luminanceSmoothing: bloomSmoothing,
  }), [bloomIntensity, bloomThreshold, bloomSmoothing]);
  
  const vignetteSettings = useMemo(() => ({
    offset: vignetteOffset,
    darkness: vignetteDarkness,
  }), [vignetteOffset, vignetteDarkness]);
  
  const ssaoSettings = useMemo(() => ({
    intensity: ssaoIntensity,
    radius: ssaoRadius,
    bias: 0.05,
    samples: 16, // Quality vs performance tradeoff
  }), [ssaoIntensity, ssaoRadius]);

  return (
    <EffectComposer
      enabled={true}
      multisampling={4} // MSAA for smoother edges
    >
      {/* SSAO - Ambient occlusion in crevices and canyon walls */}
      <SSAO
        intensity={ssaoSettings.intensity}
        radius={ssaoSettings.radius}
        bias={ssaoSettings.bias}
        samples={ssaoSettings.samples}
        depthAwareUpsampling={true}
      />
      
      {/* Bloom - Water highlights and bright reflections */}
      <Bloom
        intensity={bloomSettings.intensity}
        luminanceThreshold={bloomSettings.luminanceThreshold}
        luminanceSmoothing={bloomSettings.luminanceSmoothing}
        mipmapBlur={true} // Higher quality blur
      />
      
      {/* Vignette - Canyon tunnel feeling */}
      <Vignette
        offset={vignetteSettings.offset}
        darkness={vignetteSettings.darkness}
      />
    </EffectComposer>
  );
};

/**
 * Performance-optimized version with adaptive quality
 */
export const AdaptivePostProcessing: React.FC<{
  quality?: 'low' | 'medium' | 'high';
}> = ({ quality = 'high' }) => {
  const settings = useMemo(() => {
    switch (quality) {
      case 'low':
        return {
          bloom: { intensity: 0.4, threshold: 0.8, smoothing: 0.3 },
          vignette: { offset: 0.3, darkness: 0.5 },
          ssao: { intensity: 0.6, radius: 0.5, samples: 8 },
        };
      case 'medium':
        return {
          bloom: { intensity: 0.5, threshold: 0.77, smoothing: 0.35 },
          vignette: { offset: 0.33, darkness: 0.55 },
          ssao: { intensity: 0.9, radius: 0.65, samples: 12 },
        };
      case 'high':
      default:
        return {
          bloom: { intensity: 0.6, threshold: 0.75, smoothing: 0.4 },
          vignette: { offset: 0.35, darkness: 0.6 },
          ssao: { intensity: 1.2, radius: 0.8, samples: 16 },
        };
    }
  }, [quality]);

  return (
    <PostProcessingEffects
      bloomIntensity={settings.bloom.intensity}
      bloomThreshold={settings.bloom.threshold}
      bloomSmoothing={settings.bloom.smoothing}
      vignetteOffset={settings.vignette.offset}
      vignetteDarkness={settings.vignette.darkness}
      ssaoIntensity={settings.ssao.intensity}
      ssaoRadius={settings.ssao.radius}
    />
  );
};

export default PostProcessingEffects;
