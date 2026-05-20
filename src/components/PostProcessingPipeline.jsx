import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import * as THREE from 'three';

const CHROMATIC_ABERRATION_SHADER = {
  name: 'ChromaticAberrationShader',
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.0 },
    center: { value: new THREE.Vector2(0.5, 0.5) },
    radius: { value: 0.8 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform vec2 center;
    uniform float radius;
    varying vec2 vUv;

    void main() {
      vec2 delta = vUv - center;
      float dist = length(delta);
      if (dist < radius && amount > 0.0) {
        vec2 direction = normalize(delta);
        float factor = (1.0 - dist / radius) * amount;
        float r = texture2D(tDiffuse, vUv + direction * factor).r;
        float g = texture2D(tDiffuse, vUv).g;
        float b = texture2D(tDiffuse, vUv - direction * factor).b;
        gl_FragColor = vec4(r, g, b, 1.0);
      } else {
        gl_FragColor = texture2D(tDiffuse, vUv);
      }
    }
  `,
};

/**
 * PostProcessingPipeline - Imperative EffectComposer for R3F v9
 *
 * Uses Three.js native postprocessing passes and renders via useFrame
 * with priority > 0 so R3F skips its default gl.render() and we handle
 * composition ourselves. This avoids the @react-three/postprocessing v3
 * incompatibility with R3F v9 (null renderer crash).
 *
 * Only mount this component when quality !== 'minimal'.
 */
export function PostProcessingPipeline({
  quality = 'high',
  vehicleRef,

  bloomIntensity = 0.5,
  bloomThreshold = 0.8,
  bloomSmoothing = 0.025,
  bloomRadius = 0.5,

  vignetteOffset = 0.35,
  vignetteDarkness = 0.5,

  chromaticBaseOffset = 0.001,
  chromaticMaxOffset = 0.002,
}) {
  const { gl, scene, camera, size } = useThree();

  // Refs for smooth animation values
  const smoothed = useRef({
    chromaticOffset: chromaticBaseOffset,
    saturation: 1.0,
    vignetteBoost: 0,
  });
  const boostRef = useRef({ active: 0, intensity: 0 });

  // Listen for boost events
  useEffect(() => {
    const onBoost = (e) => {
      const detail = e.detail || {};
      boostRef.current.active = detail.duration ?? 0.8;
      boostRef.current.intensity = detail.intensity ?? 1.5;
    };
    window.addEventListener('boost-triggered', onBoost);
    return () => window.removeEventListener('boost-triggered', onBoost);
  }, []);

  // Build composer once gl/scene/camera are ready
  const composer = useMemo(() => {
    if (!gl || !scene || !camera) return null;

    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));

    const resolution = new THREE.Vector2(size.width, size.height);

    // Bloom
    const strength = bloomIntensity;
    const radius = bloomRadius;
    const threshold = bloomThreshold;
    const bloomPass = new UnrealBloomPass(resolution, strength, radius, threshold);
    composer.addPass(bloomPass);

    // Hue / Saturation (speed-based desaturation)
    const hueSatPass = new ShaderPass(HueSaturationShader);
    hueSatPass.uniforms.hue.value = 0;
    hueSatPass.uniforms.saturation.value = 0;
    composer.addPass(hueSatPass);

    // Chromatic aberration
    const chromaticPass = new ShaderPass(CHROMATIC_ABERRATION_SHADER);
    chromaticPass.uniforms.amount.value = chromaticBaseOffset;
    composer.addPass(chromaticPass);

    // Vignette
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset.value = vignetteOffset;
    vignettePass.uniforms.darkness.value = vignetteDarkness;
    composer.addPass(vignettePass);

    // Store passes for imperative updates
    composer.userData = {
      bloomPass,
      hueSatPass,
      chromaticPass,
      vignettePass,
    };

    return composer;
  }, [gl, scene, camera]);

  // Handle resize
  useEffect(() => {
    if (!composer) return;
    composer.setSize(size.width, size.height);
    const pixelRatio = gl.getPixelRatio();
    composer.setPixelRatio(pixelRatio);
  }, [size.width, size.height, composer, gl]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      if (composer) {
        composer.dispose();
      }
    };
  }, [composer]);

  // Main render loop — priority 1 tells R3F to skip default gl.render()
  useFrame((state, delta) => {
    if (!composer) return;

    const passes = composer.userData;
    if (!passes) return;

    // Decay boost
    boostRef.current.active = Math.max(0, boostRef.current.active - delta * 1.2);
    const boostScale = boostRef.current.active > 0 ? boostRef.current.intensity : 0;

    // Read velocity from vehicle RigidBody — guard NaN
    const bodyVel = vehicleRef?.current?.linvel?.();
    let velocity = 0;
    if (bodyVel && isFinite(bodyVel.x) && isFinite(bodyVel.z)) {
      velocity = Math.sqrt(bodyVel.x * bodyVel.x + bodyVel.z * bodyVel.z);
    }
    const speedFactor = Math.min(1, velocity / 25);

    // Chromatic aberration target
    const targetChromatic =
      chromaticBaseOffset + (chromaticMaxOffset - chromaticBaseOffset) * speedFactor + boostScale * 0.0025;

    // Saturation target
    let targetSaturation = 1.0;
    if (velocity > 5) {
      if (velocity <= 15) {
        targetSaturation = 1.0 - ((velocity - 5) / 10) * 0.3;
      } else if (velocity <= 25) {
        targetSaturation = 0.7 - ((velocity - 15) / 10) * 0.2;
      } else {
        targetSaturation = 0.5;
      }
    }
    targetSaturation = Math.min(1, targetSaturation + boostScale * 0.15);

    // Vignette boost target
    const targetVignetteBoost = velocity > 25 * 0.9 ? 0.3 : 0;

    // Smooth transitions
    const t = 1 - Math.exp(-delta * 10);
    smoothed.current.chromaticOffset += (targetChromatic - smoothed.current.chromaticOffset) * t;
    smoothed.current.saturation += (targetSaturation - smoothed.current.saturation) * t;
    smoothed.current.vignetteBoost += (targetVignetteBoost - smoothed.current.vignetteBoost) * t;

    // Apply to passes
    if (passes.chromaticPass) {
      passes.chromaticPass.uniforms.amount.value = smoothed.current.chromaticOffset;
    }
    if (passes.hueSatPass) {
      // HueSaturationShader expects saturation in range [-1, 1]; 1 = no change, 0 = some desat, -1 = full gray
      // Actually the shader treats saturation=0 as no change. Wait, looking at the shader:
      //   uniform float saturation;  // -1 to 1 (0 is no change)
      // So if we want desaturation, we need negative values.
      // Current saturation goes from 1.0 (full color) down to 0.5 (50% desat).
      // Map [0.5, 1.0] to [-0.5, 0]
      const satUniform = (smoothed.current.saturation - 1.0);
      passes.hueSatPass.uniforms.saturation.value = satUniform;
    }
    if (passes.vignettePass) {
      passes.vignettePass.uniforms.darkness.value = vignetteDarkness + smoothed.current.vignetteBoost;
    }
    if (passes.bloomPass) {
      passes.bloomPass.strength = bloomIntensity + boostScale * 0.4;
      passes.bloomPass.threshold = Math.max(0.2, bloomThreshold - boostScale * 0.15);
      passes.bloomPass.radius = bloomRadius + boostScale * 0.2;
    }

    composer.render();
  }, 1);

  return null;
}

export default PostProcessingPipeline;
