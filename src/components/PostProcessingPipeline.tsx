import { useMemo, useRef, useEffect, useState, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import * as THREE from 'three';
import { useLOD } from '../systems/lod/LODManager';
import { useBiome } from '../systems/biome/BiomeSystem';
import { useSunPosition } from '../systems/lighting/SunPositionSystem';
import { GOD_RAYS_SHADER } from '../systems/volumetric/VolumetricGodRays';
import { useGameStore } from '../systems/GameState';
import { useSettingsStore } from '../systems/settings/useSettingsStore';
import { qualityToEffects } from '../systems/settings/settingsDerive';
import type { VehicleRigidBodyRef } from '../experience/types';
import type { WebGPURenderer } from 'three/webgpu';
import {
  computePostFrameParams,
  createPostSmoothedState,
  godRaysAllowed,
  type PostFrameParams,
  type PostQualityLevel,
  type PostTuning,
} from './postProcessing/postFrameParams';
import { getLoadedNodePost } from './postProcessing/nodePostLoader';
import type { NodePostPipeline, NodePostStructure } from './postProcessing/nodePostPipeline';

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
  material: THREE.ShaderMaterial;

  fsQuad: FullScreenQuad;

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

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
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

interface PostProcessingPipelineProps {
  quality?: PostQualityLevel;
  vehicleRef?: RefObject<VehicleRigidBodyRef | null>;
  isTightCanyon?: boolean;
  waterfallIntensity?: number;
  bloomIntensity?: number;
  bloomThreshold?: number;
  bloomSmoothing?: number;
  bloomRadius?: number;
  vignetteOffset?: number;
  vignetteDarkness?: number;
  chromaticBaseOffset?: number;
  chromaticMaxOffset?: number;
}

interface ComposerPassBundle {
  ssaoPass: SSAOPass;
  godRaysPass: GodRaysPass;
  bloomPass: UnrealBloomPass;
  hueSatPass: ShaderPass;
  chromaticPass: ShaderPass;
  vignettePass: ShaderPass;
  rainbowPass: ShaderPass;
}

type WatershedComposer = EffectComposer & { userData: ComposerPassBundle };

/** A post driver: the JSM composer on WebGLRenderer, or the node pipeline. */
interface PostDriver {
  apply(params: PostFrameParams): void;
  render(): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

function isNodeRenderer(gl: unknown): gl is WebGPURenderer {
  return (gl as { isWebGPURenderer?: boolean } | null)?.isWebGPURenderer === true;
}

/** GLSL path: JSM EffectComposer. WebGLRenderer only. */
function createComposerDriver(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  tuning: PostTuning,
): PostDriver {
  const composer = new EffectComposer(gl) as WatershedComposer;
  composer.renderTarget1.depthBuffer = true;
  composer.renderTarget2.depthBuffer = true;
  composer.renderTarget1.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedShortType);
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedShortType);
  composer.addPass(new RenderPass(scene, camera));

  const resolution = new THREE.Vector2(width, height);

  // Ambient occlusion — contact shadows in canyon crevices (wall/floor joins,
  // rock clusters). Runs first so god rays/bloom/vignette are applied on top
  // of the occluded image. Gated off on low/medium via effectPresence.ssao.
  const ssaoPass = new SSAOPass(scene, camera, width, height, 24);
  ssaoPass.kernelRadius = 6;
  ssaoPass.minDistance = 0.0025;
  ssaoPass.maxDistance = 0.25;
  ssaoPass.output = SSAOPass.OUTPUT.Default;
  composer.addPass(ssaoPass);

  // Volumetric god rays (slot canyons)
  const godRaysPass = new GodRaysPass();
  godRaysPass.enabled = false;
  composer.addPass(godRaysPass);

  const bloomPass = new UnrealBloomPass(resolution, tuning.bloomIntensity, tuning.bloomRadius, tuning.bloomThreshold);
  composer.addPass(bloomPass);

  // Hue / Saturation (speed-based desaturation)
  const hueSatPass = new ShaderPass(HueSaturationShader);
  hueSatPass.uniforms.hue.value = 0;
  hueSatPass.uniforms.saturation.value = 0;
  composer.addPass(hueSatPass);

  const chromaticPass = new ShaderPass(CHROMATIC_ABERRATION_SHADER);
  chromaticPass.uniforms.amount.value = tuning.chromaticBaseOffset;
  composer.addPass(chromaticPass);

  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms.offset.value = tuning.vignetteOffset;
  vignettePass.uniforms.darkness.value = tuning.vignetteDarkness;
  composer.addPass(vignettePass);

  // Rainbow god-ray overlay (waterfall mist prismatic arc)
  const rainbowPass = new ShaderPass(RAINBOW_SHADER);
  rainbowPass.uniforms.intensity.value = 0;
  rainbowPass.uniforms.aspectRatio.value = width / Math.max(1, height);
  composer.addPass(rainbowPass);

  composer.userData = { ssaoPass, godRaysPass, bloomPass, hueSatPass, chromaticPass, vignettePass, rainbowPass };

  return {
    apply(p) {
      bloomPass.enabled = p.bloom.enabled;
      bloomPass.strength = p.bloom.strength;
      bloomPass.threshold = p.bloom.threshold;
      bloomPass.radius = p.bloom.radius;
      vignettePass.enabled = p.vignette.enabled;
      vignettePass.uniforms.offset.value = p.vignette.offset;
      vignettePass.uniforms.darkness.value = p.vignette.darkness;
      chromaticPass.enabled = p.chromatic.enabled;
      chromaticPass.uniforms.amount.value = p.chromatic.amount;
      ssaoPass.enabled = p.ssao.enabled;
      hueSatPass.uniforms.saturation.value = p.hueSaturation.saturation;

      godRaysPass.enabled = p.godRays.enabled;
      if (godRaysPass.enabled) {
        const uniforms = godRaysPass.material.uniforms;
        // Params are in screen space with a top-left origin (the node path's
        // screenUV); the fullscreen quad's vUv is bottom-left, so flip y.
        uniforms.sunScreenPosition.value.set(p.godRays.sunScreenPosition.x, 1 - p.godRays.sunScreenPosition.y);
        uniforms.sunColor.value.copy(p.godRays.sunColor);
        uniforms.intensity.value = p.godRays.intensity;
        uniforms.samples.value = p.godRays.samples;
        uniforms.decay.value = p.godRays.decay;
        uniforms.exposure.value = p.godRays.exposure;
        uniforms.rayLength.value = p.godRays.rayLength;
        uniforms.density.value = p.godRays.density;
        uniforms.wallOcclusion.value = p.godRays.wallOcclusion;
        uniforms.time.value = p.godRays.time;
      }

      rainbowPass.uniforms.intensity.value = p.rainbow.intensity;
      rainbowPass.uniforms.time.value = p.rainbow.time;
      rainbowPass.uniforms.aspectRatio.value = p.rainbow.aspectRatio;
    },
    render() {
      composer.render();
    },
    setSize(w, h, pixelRatio) {
      composer.setSize(w, h);
      composer.setPixelRatio(pixelRatio);
    },
    dispose() {
      // EffectComposer.dispose() only frees its own render targets, not each
      // pass's — SSAOPass owns three full-res render targets of its own.
      ssaoPass.dispose();
      composer.dispose();
    },
  };
}

function nodeStructureFor(p: PostFrameParams): NodePostStructure {
  return {
    bloom: p.bloom.enabled,
    ssao: p.ssao.enabled,
    godRays: p.godRays.allowed,
    chromatic: p.chromatic.enabled,
  };
}

/** TSL path: three's node RenderPipeline (epic #434 B2). Null if the module isn't loaded. */
function createNodeDriver(
  gl: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  initial: NodePostStructure,
): PostDriver | null {
  const mod = getLoadedNodePost();
  if (!mod) {
    console.warn('[Post] node post module not loaded — rendering the node path without post.');
    return null;
  }
  const pipeline: NodePostPipeline = mod.createNodePostPipeline(gl, scene, camera, initial);
  return {
    apply(p) {
      pipeline.setStructure(nodeStructureFor(p));
      pipeline.update(p);
    },
    render() {
      pipeline.render();
    },
    // PassNode / RTTNode / bloom / GTAO size themselves from the renderer.
    setSize() {},
    dispose() {
      pipeline.dispose();
    },
  };
}

/**
 * PostProcessingPipeline — one post stack per renderer, never two.
 *
 * - `THREE.WebGLRenderer` (default GLSL product path): JSM `EffectComposer`.
 * - Node `WebGPURenderer` (`?material=tsl`, WebGL2 or native WebGPU backend):
 *   three's node `RenderPipeline`, built in `postProcessing/nodePostPipeline.ts`.
 *
 * Both drivers read the same per-frame parameters (`computePostFrameParams`),
 * so the two paths render the same post set from the same inputs.
 *
 * Renders from a priority-1 `useFrame`, so R3F skips its default gl.render().
 * If no driver can be built, the frame falls back to a plain scene render
 * rather than presenting nothing.
 */
export function PostProcessingPipeline({
  quality = 'high',
  vehicleRef,
  isTightCanyon = false,
  waterfallIntensity = 0,

  bloomIntensity = 0.5,
  bloomThreshold = 0.8,
  bloomRadius = 0.5,

  vignetteOffset = 0.35,
  vignetteDarkness = 0.5,

  chromaticBaseOffset = 0.001,
  chromaticMaxOffset = 0.002,
}: PostProcessingPipelineProps) {
  const { gl, scene, camera, size } = useThree();
  const { config } = useLOD();
  const { timeOfDay, currentBiome } = useBiome();
  const { sunWorldPosition } = useSunPosition();
  const settingsQuality = useSettingsStore((s) => (s._hasHydrated ? s.quality : 'high'));
  const effectPresence = useMemo(() => qualityToEffects(settingsQuality), [settingsQuality]);

  const tuning: PostTuning = useMemo(
    () => ({
      bloomIntensity,
      bloomThreshold,
      bloomRadius,
      vignetteOffset,
      vignetteDarkness,
      chromaticBaseOffset,
      chromaticMaxOffset,
    }),
    [bloomIntensity, bloomThreshold, bloomRadius, vignetteOffset, vignetteDarkness, chromaticBaseOffset, chromaticMaxOffset],
  );

  const smoothed = useRef(createPostSmoothedState(tuning));
  const boostRef = useRef({ active: 0, intensity: 0 });
  const [weatherType, setWeatherType] = useState('clear');

  // Listen for boost events
  useEffect(() => {
    const onBoost = (e: Event) => {
      const detail = (e as CustomEvent<{ duration?: number; intensity?: number }>).detail || {};
      boostRef.current.active = detail.duration ?? 0.8;
      boostRef.current.intensity = detail.intensity ?? 1.5;
    };
    window.addEventListener('boost-triggered', onBoost);
    return () => window.removeEventListener('boost-triggered', onBoost);
  }, []);

  // Listen for weather changes — desaturates and softens the scene under
  // overcast/storm, and tightens the vignette for stormy drama.
  useEffect(() => {
    const onWeatherUpdate = (e: Event) => {
      const incoming = (e as CustomEvent<{ type?: string }>)?.detail?.type;
      if (typeof incoming === 'string') setWeatherType(incoming);
    };
    window.addEventListener('weather-update', onWeatherUpdate);
    return () => window.removeEventListener('weather-update', onWeatherUpdate);
  }, []);

  // Initial node-graph structure only; later changes rebuild in place via
  // setStructure, so they must not recreate the driver.
  const initialStructure = useRef<NodePostStructure>({
    bloom: effectPresence.bloom,
    ssao: effectPresence.ssao,
    godRays: godRaysAllowed({ effectPresence, quality, enableGodRays: config.enableGodRays }),
    chromatic: effectPresence.chromaticAberration,
  });

  // The composer's depth textures are sized at construction, so the JSM driver
  // is rebuilt on resize (as before); the node driver sizes itself.
  const nodePath = isNodeRenderer(gl);
  const composerWidth = nodePath ? 0 : size.width;
  const composerHeight = nodePath ? 0 : size.height;

  const driver = useMemo((): PostDriver | null => {
    if (!gl || !scene || !camera) return null;
    if (isNodeRenderer(gl)) {
      return createNodeDriver(gl, scene, camera, initialStructure.current);
    }
    return createComposerDriver(gl, scene, camera, composerWidth, composerHeight, tuning);
    // tuning seeds construction only; per-frame values flow through apply().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, composerWidth, composerHeight]);

  // Handle resize
  useEffect(() => {
    if (!driver) return;
    driver.setSize(size.width, size.height, gl.getPixelRatio());
  }, [size.width, size.height, driver, gl]);

  useEffect(() => () => driver?.dispose(), [driver]);

  // Main render loop — priority 1 tells R3F to skip default gl.render()
  useFrame((state, delta) => {
    if (!driver) {
      gl.render(scene, camera);
      return;
    }

    // Decay boost
    boostRef.current.active = Math.max(0, boostRef.current.active - delta * 1.2);

    // Read velocity from vehicle RigidBody — guard NaN
    const bodyVel = vehicleRef?.current?.linvel?.();
    let velocity = 0;
    if (bodyVel && isFinite(bodyVel.x) && isFinite(bodyVel.z)) {
      velocity = Math.sqrt(bodyVel.x * bodyVel.x + bodyVel.z * bodyVel.z);
    }

    const gameState = useGameStore.getState();
    const params = computePostFrameParams(
      {
        delta,
        elapsed: state.clock.elapsedTime,
        velocity,
        waterfallIntensity,
        isTightCanyon,
        biomeId: currentBiome?.id,
        weatherType,
        timeOfDay,
        sunWorldPosition,
        camera,
        quality,
        enableGodRays: config.enableGodRays,
        volumetricSamples: config.volumetricSamples,
        effectPresence,
        isRunner: gameState.vehicleType === 'runner',
        sprintStamina: gameState.sprintStamina,
        boostActive: boostRef.current.active,
        boostIntensity: boostRef.current.intensity,
        aspectRatio: size.width / Math.max(1, size.height),
      },
      tuning,
      smoothed.current,
    );

    driver.apply(params);
    driver.render();
  }, 1);

  return null;
}

export default PostProcessingPipeline;
