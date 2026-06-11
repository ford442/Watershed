import { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import * as THREE from 'three';
import { useLOD } from '../systems/LODManager';
import { useBiome } from '../systems/BiomeSystem';
import { useSunPosition } from '../systems/SunPositionSystem';
import { GOD_RAYS_SHADER, getGodRaySunColor } from '../systems/volumetric/VolumetricGodRays';
import { useGameStore } from '../systems/GameState';

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

const RAINBOW_SHADER = {
  name: 'RainbowShader',
  uniforms: {
    tDiffuse: { value: null },
    intensity: { value: 0.0 },
    time: { value: 0.0 },
    aspectRatio: { value: 1.0 },
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
    uniform float intensity;
    uniform float time;
    uniform float aspectRatio;
    varying vec2 vUv;

    // Hue to RGB — perceptually accurate spectral spread
    vec3 hue2rgb(float h) {
      h = fract(h);
      float r = abs(h * 6.0 - 3.0) - 1.0;
      float g = 2.0 - abs(h * 6.0 - 2.0);
      float b = 2.0 - abs(h * 6.0 - 4.0);
      return clamp(vec3(r, g, b), 0.0, 1.0);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);

      if (intensity < 0.005) {
        gl_FragColor = base;
        return;
      }

      // Arc center: slightly below screen center — where waterfall spray collects
      vec2 arcCenter = vec2(0.5, 0.52);
      vec2 delta = (vUv - arcCenter) * vec2(aspectRatio, 1.0);
      float dist = length(delta);

      float inner = 0.20;
      float outer = 0.37;
      float band = smoothstep(inner - 0.03, inner, dist)
                 * smoothstep(outer + 0.03, outer, dist);

      // Show only the upper arc (above the center in UV space = lower delta.y)
      float arcMask = smoothstep(0.06, -0.04, delta.y / max(dist, 0.001));

      // t = 0 at inner (violet), 1 at outer (red) — matches real rainbow
      float t = clamp((dist - inner) / max(outer - inner, 0.001), 0.0, 1.0);
      float hue = (1.0 - t) * 0.75; // 0.75 = violet, 0.0 = red
      vec3 spectral = hue2rgb(hue);

      // Gentle shimmer to mimic moving mist diffraction
      float shimmer = 0.8 + sin(time * 2.5 + dist * 24.0) * 0.2;

      float rainbow = band * arcMask * shimmer * intensity * 0.28;
      gl_FragColor = vec4(base.rgb + spectral * rainbow, base.a);
    }
  `,
};

class GodRaysPass extends Pass {
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(GOD_RAYS_SHADER.uniforms),
      vertexShader: GOD_RAYS_SHADER.vertexShader,
      fragmentShader: GOD_RAYS_SHADER.fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tDepth.value = readBuffer.depthTexture || readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
      return;
    }

    renderer.setRenderTarget(writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

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
  isTightCanyon = false,
  waterfallIntensity = 0,

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
  const { config } = useLOD();
  const { timeOfDay, currentBiome } = useBiome();
  const { sunWorldPosition } = useSunPosition();

  // Refs for smooth animation values
  const smoothed = useRef({
    chromaticOffset: chromaticBaseOffset,
    saturation: 1.0,
    vignetteBoost: 0,
  });
  const boostRef = useRef({ active: 0, intensity: 0 });
  const [weatherType, setWeatherType] = useState('clear');

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

  // Listen for weather changes — desaturates and softens the scene under
  // overcast/storm, and tightens the vignette for stormy drama.
  useEffect(() => {
    const onWeatherUpdate = (e) => {
      const incoming = e?.detail?.type;
      if (typeof incoming === 'string') setWeatherType(incoming);
    };
    window.addEventListener('weather-update', onWeatherUpdate);
    return () => window.removeEventListener('weather-update', onWeatherUpdate);
  }, []);

  // Build composer once gl/scene/camera are ready
  const composer = useMemo(() => {
    if (!gl || !scene || !camera) return null;

    const composer = new EffectComposer(gl);
    composer.renderTarget1.depthBuffer = true;
    composer.renderTarget2.depthBuffer = true;
    composer.renderTarget1.depthTexture = new THREE.DepthTexture(size.width, size.height, THREE.UnsignedShortType);
    composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.width, size.height, THREE.UnsignedShortType);
    composer.addPass(new RenderPass(scene, camera));

    const resolution = new THREE.Vector2(size.width, size.height);

    // Volumetric god rays (slot canyons)
    const godRaysPass = new GodRaysPass();
    godRaysPass.enabled = false;
    composer.addPass(godRaysPass);

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

    // Rainbow god-ray overlay (waterfall mist prismatic arc)
    const rainbowPass = new ShaderPass(RAINBOW_SHADER);
    rainbowPass.uniforms.intensity.value = 0;
    rainbowPass.uniforms.aspectRatio.value = size.width / Math.max(1, size.height);
    composer.addPass(rainbowPass);

    // Store passes for imperative updates
    composer.userData = {
      godRaysPass,
      bloomPass,
      hueSatPass,
      chromaticPass,
      vignettePass,
      rainbowPass,
    };

    return composer;
  }, [gl, scene, camera, size.height, size.width]);

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
    const waterfallBoost = THREE.MathUtils.clamp(waterfallIntensity, 0, 1);

    // Biome/weather mood — slot canyons get a more artistic, claustrophobic
    // vignette; overcast/storm desaturate and soften the whole frame.
    const isSlotCanyon = currentBiome?.id === 'slotCanyon';
    const overcastBlend = weatherType === 'storm' ? 1
      : weatherType === 'overcast' ? 0.6
      : weatherType === 'fog' ? 0.35
      : 0;
    const sunElevation = THREE.MathUtils.clamp(sunWorldPosition.y / 40, 0, 1);
    const nightFactor = 1 - sunElevation;

    // Chromatic aberration target
    const targetChromatic =
      chromaticBaseOffset + (chromaticMaxOffset - chromaticBaseOffset) * speedFactor + boostScale * 0.0025 + waterfallBoost * 0.0009;

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
    // Overcast/storm/fog wash the color out of the whole scene.
    targetSaturation *= 1 - overcastBlend * 0.4;

    // Vignette boost target
    // "Speed rush" design: vignette tightens modestly when actively sprinting at speed
    // (tunnel-vision rush feel). Normalizes on raft or when not sprinting.
    const gameState = useGameStore.getState();
    const isRunner = gameState.vehicleType === 'runner';
    const sprintStamina = gameState.sprintStamina;
    // Consider sprint active when stamina is being consumed (stamina < 1 and speed is high)
    // We detect "sprinting at speed" by checking speed threshold + stamina drain state.
    const isSprintingAtSpeed = isRunner && velocity > 12 && sprintStamina < 0.999;
    const sprintVignetteBoost = isSprintingAtSpeed ? 0.18 : 0;
    // Slot canyons get a deliberately tighter, more cinematic vignette to sell
    // the claustrophobic walls; storms tighten it further for drama.
    const biomeVignetteBoost = (isSlotCanyon ? 0.12 : 0) + overcastBlend * 0.08;
    const targetVignetteBoost = (velocity > 25 * 0.9 ? 0.3 : 0) + waterfallBoost * 0.08 + sprintVignetteBoost + biomeVignetteBoost;

    // Smooth transitions
    const t = 1 - Math.exp(-delta * 10);
    smoothed.current.chromaticOffset += (targetChromatic - smoothed.current.chromaticOffset) * t;
    smoothed.current.saturation += (targetSaturation - smoothed.current.saturation) * t;
    smoothed.current.vignetteBoost += (targetVignetteBoost - smoothed.current.vignetteBoost) * t;

    // Apply to passes
    if (passes.godRaysPass) {
      const shouldRenderGodRays =
        (isTightCanyon || waterfallBoost > 0.2) &&
        (quality === 'medium' || quality === 'high' || quality === 'ultra') &&
        (config.enableGodRays || quality === 'medium');

      const samples = quality === 'medium' ? 16 : Math.max(48, config.volumetricSamples || 48);
      const sunClip = sunWorldPosition.clone().project(camera);
      const sunVisible = sunClip.z > -1.0 && sunClip.z < 1.0;
      const cameraForward = new THREE.Vector3();
      camera.getWorldDirection(cameraForward);
      const sunDir = sunWorldPosition.clone().sub(camera.position).normalize();
      const alignment = Math.max(0, cameraForward.dot(sunDir));

      passes.godRaysPass.enabled = shouldRenderGodRays && sunVisible;
      if (passes.godRaysPass.enabled) {
        const uniforms = passes.godRaysPass.material.uniforms;
        uniforms.sunScreenPosition.value.set((sunClip.x + 1) * 0.5, (1 - sunClip.y) * 0.5);
        uniforms.sunColor.value.copy(getGodRaySunColor(timeOfDay));
        uniforms.intensity.value = (quality === 'medium' ? 0.45 : 0.6) * Math.max(0.35, alignment) * (1 + waterfallBoost * 0.55);
        uniforms.samples.value = samples;
        uniforms.decay.value = 0.95;
        uniforms.exposure.value = quality === 'medium' ? 0.14 : 0.18;
        uniforms.rayLength.value = 0.4;
        uniforms.density.value = 0.96;
        uniforms.wallOcclusion.value = 0.92;
        uniforms.time.value = state.clock.elapsedTime;
      }
    }

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
      // At night, drop the threshold so fireflies, moonlit water glints, and
      // wet specular highlights glow instead of getting clipped — but trim
      // overall strength under heavy overcast/storm so the look stays moody
      // rather than glary.
      passes.bloomPass.strength = (bloomIntensity + boostScale * 0.4 + waterfallBoost * 0.55) * (1 - overcastBlend * 0.3);
      passes.bloomPass.threshold = Math.max(0.15, bloomThreshold - boostScale * 0.15 - waterfallBoost * 0.1 - nightFactor * 0.25);
      passes.bloomPass.radius = bloomRadius + boostScale * 0.2 + waterfallBoost * 0.12 + nightFactor * 0.08;
    }

    // Rainbow prismatic arc — only during waterfall, fades quickly outside it
    if (passes.rainbowPass) {
      const targetRainbow = Math.max(0, (waterfallBoost - 0.35) / 0.65);
      const currentRainbow = passes.rainbowPass.uniforms.intensity.value;
      passes.rainbowPass.uniforms.intensity.value +=
        (targetRainbow - currentRainbow) * (1 - Math.exp(-delta * 3));
      passes.rainbowPass.uniforms.time.value = state.clock.elapsedTime;
      passes.rainbowPass.uniforms.aspectRatio.value = size.width / Math.max(1, size.height);
    }

    composer.render();
  }, 1);

  return null;
}

export default PostProcessingPipeline;
