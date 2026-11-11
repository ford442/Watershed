import { useMemo, useRef, useEffect, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import * as THREE from 'three';
import { useLOD } from '../systems/lod/LODManager';
import { useBiomeId, useBiomeTimeOfDay } from '../systems/biome/BiomeSystem';
import { useSunPosition } from '../systems/lighting/SunPositionSystem';
import { GOD_RAYS_SHADER } from '../systems/volumetric/VolumetricGodRays';
import { useGameStore } from '../systems/GameState';
import { effectsForLODQuality } from '../systems/settings/settingsDerive';
import type { VehicleRigidBodyRef } from '../experience/types';
import type { WebGPURenderer } from 'three/webgpu';
import {
  aaTierFor,
  computePostFrameParams,
  createAaTierLatch,
  createPostSmoothedState,
  godRaysAllowed,
  type PostFrameParams,
  type PostQualityLevel,
  type PostTuning,
} from './postProcessing/postFrameParams';
import { getLoadedNodePost } from './postProcessing/nodePostLoader';
import { getComfort } from '../systems/settings/comfortRuntime';
import { smaaPassModule, ssaoPassModule } from './postProcessing/composerPassModules';
import type { NodePostPipeline, NodePostStructure } from './postProcessing/nodePostPipeline';
import { gameEvents } from '../systems/events/GameEvents';

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

  /** The scene pass's depth texture this frame (`SceneRenderPass.depthTexture`). */
  private readonly sceneDepth: () => THREE.Texture | null;

  constructor(sceneDepth: () => THREE.Texture | null) {
    super();
    this.sceneDepth = sceneDepth;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(GOD_RAYS_SHADER.uniforms),
      vertexShader: GOD_RAYS_SHADER.vertexShader,
      fragmentShader: GOD_RAYS_SHADER.fragmentShader,
      // The shader outputs scene + rays itself; blending onto writeBuffer would
      // add the rays to whatever stale image that target still holds.
      blending: THREE.NoBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tDepth.value = this.sceneDepth() ?? readBuffer.depthTexture ?? readBuffer.texture;

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
 * The scene pass, and the frame's one shadow-map update. It is the first
 * effect, so three's output skips its own scene render and this pass draws
 * into the output's scene target (`readBuffer`, three's `WebGLOutput` target A:
 * HalfFloat colour + 24-bit depth texture).
 *
 * - **MSAA lives here, on the one target that needs it.** `samples` is set on
 *   target A from the latched AA tier before the draw; every later target stays
 *   single-sampled (#519 B.5). three reallocates the target on its next bind.
 * - **Shadows once.** Later passes that re-render the scene (SSAOPass's normal
 *   pass) would otherwise re-render every shadow map for an override material
 *   that never samples them. The driver's `render()` restores `autoUpdate`.
 * - **Scene depth for the passes after it.** `depthTexture` is published so god
 *   rays sample the depth this frame wrote, whichever buffer they read colour from.
 */
class SceneRenderPass extends RenderPass {
  /** MSAA sample count for the scene target, from the driver's AA latch. */
  samples = 0;

  depthTexture: THREE.DepthTexture | null = null;

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    if (readBuffer.samples !== this.samples) {
      readBuffer.samples = this.samples;
      readBuffer.dispose();
    }
    this.depthTexture = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    renderer.shadowMap.autoUpdate = false;
  }
}

/**
 * The display transform (tone map + sRGB), *inside* the chain — only while the
 * AA tier is SMAA, whose edge detection is tuned for display-referred input.
 * three's output then has to be the identity: the driver renders with
 * `toneMapping = NoToneMapping` and a linear `outputColorSpace`, and this pass
 * puts the real grade back for its own draw. A wrapper, not an `OutputPass` in
 * the list: three warns on `isOutputPass` in `setEffects`.
 */
class DisplayTransformPass extends Pass {
  private readonly output = new OutputPass();

  grade: { toneMapping: THREE.ToneMapping; outputColorSpace: string } = {
    toneMapping: THREE.NoToneMapping,
    outputColorSpace: THREE.LinearSRGBColorSpace,
  };

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    const toneMapping = renderer.toneMapping;
    const outputColorSpace = renderer.outputColorSpace;
    renderer.toneMapping = this.grade.toneMapping;
    renderer.outputColorSpace = this.grade.outputColorSpace as THREE.ColorSpace;
    try {
      this.output.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      renderer.toneMapping = toneMapping;
      renderer.outputColorSpace = outputColorSpace;
    }
  }

  dispose() {
    this.output.dispose();
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

/** A post driver: three's output effects on WebGLRenderer, or the node pipeline. */
export interface PostDriver {
  apply(params: PostFrameParams): void;
  render(): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

/** The GLSL driver, with what tests, the parity page and the warm-up read. */
export interface EffectsDriver extends PostDriver {
  /** The effect list in chain order, as handed to `renderer.setEffects` (enabled or not). */
  readonly effects: readonly Pass[];
  /** Clear this driver's effects from the renderer if they are installed; the driver stays usable. */
  detach(): void;
}

function isNodeRenderer(gl: unknown): gl is WebGPURenderer {
  return (gl as { isWebGPURenderer?: boolean } | null)?.isWebGPURenderer === true;
}

/**
 * Which driver's effects a renderer holds. A renderer has one effect list and
 * applies it to *every* `render()` to the canvas, so a driver installs its
 * list when it renders and clears it when it is done — the warm-up's throwaway
 * drivers (`shaderWarmupRun.ts`) and the live one share one renderer.
 */
const installedDriver = new WeakMap<THREE.WebGLRenderer, object>();

/**
 * GLSL path: three's own HDR output (`outputBufferType: HalfFloatType`,
 * `renderer.setEffects`, r185 `WebGLOutput`). `createGameRenderer` builds the
 * renderer that way; a renderer without it logs three's error and draws plain.
 *
 * Every effect works on linear HDR in the output's half-float targets; three
 * applies the chain's one tone map (`gl.toneMapping`, exposure) and one sRGB
 * encode (`gl.outputColorSpace`) in its final blit — the same transform the
 * node RenderPipeline applies via `outputColorTransform` (#466 Phase A). With
 * SMAA the transform moves into the chain ahead of it (`DisplayTransformPass`).
 *
 * The output owns the targets and their size: `renderer.setSize` /
 * `setPixelRatio` (R3F's setDpr, the render-scale valve) resize them and every
 * effect once, so `setSize` here is a no-op.
 */
export function createComposerDriver(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  tuning: PostTuning,
): EffectsDriver {
  const scenePass = new SceneRenderPass(scene, camera);

  const resolution = new THREE.Vector2(width, height);

  // Volumetric god rays (slot canyons)
  const godRaysPass = new GodRaysPass(() => scenePass.depthTexture);
  godRaysPass.enabled = false;

  const bloomPass = new UnrealBloomPass(resolution, tuning.bloomIntensity, tuning.bloomRadius, tuning.bloomThreshold);

  // Hue / Saturation (speed-based desaturation)
  const hueSatPass = new ShaderPass(HueSaturationShader);
  hueSatPass.uniforms.hue.value = 0;
  hueSatPass.uniforms.saturation.value = 0;

  const chromaticPass = new ShaderPass(CHROMATIC_ABERRATION_SHADER);
  chromaticPass.uniforms.amount.value = tuning.chromaticBaseOffset;

  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms.offset.value = tuning.vignetteOffset;
  vignettePass.uniforms.darkness.value = tuning.vignetteDarkness;

  // Rainbow god-ray overlay (waterfall mist prismatic arc)
  const rainbowPass = new ShaderPass(RAINBOW_SHADER);
  rainbowPass.uniforms.intensity.value = 0;
  rainbowPass.uniforms.aspectRatio.value = width / Math.max(1, height);

  const displayPass = new DisplayTransformPass();
  displayPass.enabled = false;

  let ssaoPass: SSAOPass | undefined;
  let smaaPass: SMAAPass | undefined;
  let disposed = false;
  const effects: Pass[] = [];
  let effectsDirty = true;
  const rebuildEffects = () => {
    effects.length = 0;
    effects.push(scenePass);
    if (ssaoPass) effects.push(ssaoPass);
    effects.push(godRaysPass, bloomPass, hueSatPass, chromaticPass, vignettePass, rainbowPass);
    if (smaaPass) effects.push(displayPass, smaaPass);
    effectsDirty = true;
  };
  rebuildEffects();

  // Ambient occlusion — contact shadows in canyon crevices (wall/floor joins,
  // rock clusters). Sits right after the scene render so god rays/bloom/vignette
  // are applied on top of the occluded image. Gated off on low/medium via
  // effectPresence.ssao, so its code and its render targets only exist once a
  // frame asks for it (the import is kicked off from the pipeline's mount).
  const ensureSsaoPass = () => {
    if (ssaoPass || disposed) return;
    const mod = ssaoPassModule.get();
    if (!mod) {
      void ssaoPassModule.load().catch(() => {});
      return;
    }
    const { SSAOPass } = mod;
    ssaoPass = new SSAOPass(scene, camera, width, height, 24);
    ssaoPass.kernelRadius = 6;
    ssaoPass.minDistance = 0.0025;
    ssaoPass.maxDistance = 0.25;
    ssaoPass.output = SSAOPass.OUTPUT.Default;
    rebuildEffects();
  };

  // Edge AA, after the display transform: SMAA's edge detection is tuned for
  // display-referred (sRGB) input. Added on the first frame whose tier is SMAA;
  // apply() flips `enabled` from then on.
  const ensureSmaaPass = () => {
    if (smaaPass || disposed) return;
    const mod = smaaPassModule.get();
    if (!mod) {
      void smaaPassModule.load().catch(() => {});
      return;
    }
    smaaPass = new mod.SMAAPass();
    rebuildEffects();
  };

  // Hysteresis: a tier flip that only lasts a few frames (the adaptive valve
  // wobbling on the Ultra ↔ High boundary) must not reallocate the scene target.
  const aaLatch = createAaTierLatch();

  const driver: EffectsDriver = {
    effects,
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
      if (p.ssao.enabled) ensureSsaoPass();
      if (ssaoPass) ssaoPass.enabled = p.ssao.enabled;
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

      const aa = aaLatch.update(p.aa);
      if (aa === 'smaa') ensureSmaaPass();
      const smaa = aa === 'smaa' && smaaPass !== undefined;
      if (smaaPass) smaaPass.enabled = smaa;
      displayPass.enabled = smaa;
      scenePass.samples = aa === 'msaa4' ? 4 : 0;
    },
    render() {
      if (disposed) return;
      if (effectsDirty || installedDriver.get(gl) !== driver) {
        gl.setEffects(effects);
        installedDriver.set(gl, driver);
        effectsDirty = false;
      }
      const shadowMap = gl.shadowMap;
      const shadowAutoUpdate = shadowMap.autoUpdate;
      const toneMapping = gl.toneMapping;
      const outputColorSpace = gl.outputColorSpace;
      if (displayPass.enabled) {
        // The chain grades itself (DisplayTransformPass); three's blit must not grade again.
        displayPass.grade = { toneMapping, outputColorSpace };
        gl.toneMapping = THREE.NoToneMapping;
        gl.outputColorSpace = THREE.LinearSRGBColorSpace;
      }
      try {
        gl.render(scene, camera);
      } finally {
        shadowMap.autoUpdate = shadowAutoUpdate;
        gl.toneMapping = toneMapping;
        gl.outputColorSpace = outputColorSpace;
      }
    },
    setSize() {},
    detach() {
      if (installedDriver.get(gl) !== driver) return;
      gl.setEffects([]);
      installedDriver.delete(gl);
    },
    dispose() {
      driver.detach();
      disposed = true;
      // Each pass owns its targets; nothing frees them for us.
      ssaoPass?.dispose();
      smaaPass?.dispose();
      displayPass.dispose();
      godRaysPass.dispose();
      bloomPass.dispose();
      hueSatPass.dispose();
      chromaticPass.dispose();
      vignettePass.dispose();
      rainbowPass.dispose();
    },
  };
  return driver;
}

function nodeStructureFor(p: PostFrameParams): NodePostStructure {
  return {
    bloom: p.bloom.enabled,
    ssao: p.ssao.enabled,
    godRays: p.godRays.allowed,
    chromatic: p.chromatic.enabled,
    aa: p.aa === 'none' ? 'none' : 'smaa',
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
 * - `THREE.WebGLRenderer` (default GLSL product path): three's output effects
 *   (`renderer.setEffects`, HalfFloat output buffer).
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
  const timeOfDay = useBiomeTimeOfDay();
  const biomeId = useBiomeId();
  const { sunWorldPosition } = useSunPosition();
  // From the *effective* quality (the adaptive LOD's, passed in as `quality`),
  // like the AA tier — not the settings preset. An adaptive High → Medium drop
  // under load must shed SSAO (a full extra scene render) too.
  const effectPresence = useMemo(() => effectsForLODQuality(quality), [quality]);

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
  const weatherType = useGameStore((s) => s.weather.type);

  // Listen for boost events
  useEffect(() => {
    return gameEvents.on('boost-triggered', ({ duration, intensity }) => {
      boostRef.current.active = duration;
      boostRef.current.intensity = intensity;
    });
  }, []);

  // Listen for weather changes — desaturates and softens the scene under
  // overcast/storm, and tightens the vignette for stormy drama.

  // Initial node-graph structure only; later changes rebuild in place via
  // setStructure, so they must not recreate the driver.
  const initialStructure = useRef<NodePostStructure>({
    bloom: effectPresence.bloom,
    ssao: effectPresence.ssao,
    godRays: godRaysAllowed({ effectPresence, quality, enableGodRays: config.enableGodRays }),
    chromatic: effectPresence.chromaticAberration,
    aa: aaTierFor(quality) === 'none' ? 'none' : 'smaa',
  });

  // Construction size only — the JSM driver follows later CSS-size and DPR
  // changes through setSize (three resizes each target's depth texture to match
  // on the next bind), so a resize never rebuilds it. The node driver sizes
  // itself from the renderer.
  const constructionSize = useRef({ width: size.width, height: size.height });

  // Start fetching the preset-gated passes at mount, a frame ahead of the first apply() that
  // builds them. Only the GLSL composer uses them; the node pipeline has its own SSAO/SMAA.
  const wantsSsao = effectPresence.ssao;
  const wantsSmaa = aaTierFor(quality) === 'smaa';
  useEffect(() => {
    if (isNodeRenderer(gl)) return;
    if (wantsSsao) void ssaoPassModule.load().catch(() => {});
    if (wantsSmaa) void smaaPassModule.load().catch(() => {});
  }, [gl, wantsSsao, wantsSmaa]);

  // tuning seeds construction only; per-frame values flow through apply(). Read
  // through a ref so a tuning change does not rebuild the driver, while a rebuild
  // (new gl / scene / camera) still seeds from the tuning of that render.
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;
  const driver = useMemo((): PostDriver | null => {
    if (!gl || !scene || !camera) return null;
    if (isNodeRenderer(gl)) {
      return createNodeDriver(gl, scene, camera, initialStructure.current);
    }
    const { width, height } = constructionSize.current;
    return createComposerDriver(gl, scene, camera, width, height, tuningRef.current);
  }, [gl, scene, camera]);

  // Follow CSS size *and* DPR. `viewport.dpr` is what R3F's setDpr writes —
  // RendererQualitySync drives it from the render-scale valve (#419) — so a
  // closing valve now shrinks the composer's targets (scene render, SSAO,
  // bloom), not just the final blit (#466 Phase B).
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => {
    if (!driver) return;
    driver.setSize(size.width, size.height, dpr);
  }, [size.width, size.height, dpr, driver]);

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
        biomeId,
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
      getComfort(),
    );

    driver.apply(params);
    driver.render();
  }, 1);

  return null;
}
