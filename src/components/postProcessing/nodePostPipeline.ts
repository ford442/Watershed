/**
 * nodePostPipeline — the TSL twin of the JSM post stack (epic #434 B2).
 *
 * Three's node `RenderPipeline` (r183's name for `PostProcessing`) driving the
 * same pass set `PostProcessingPipeline` builds on the GLSL path:
 *
 *   scene → GTAO (+ denoise) → god rays (additive) → bloom (additive) → hue/saturation
 *         → chromatic aberration → vignette → waterfall rainbow
 *
 * Only ever constructed for a node renderer (`?material=tsl`); the GLSL path
 * keeps JSM `EffectComposer`. Never both in one session — the host picks one.
 *
 * Cheap effects are always in the graph and go inert via their uniforms (the
 * JSM path's `pass.enabled`). The expensive ones — GTAO, bloom, the god-ray
 * march, and the chromatic-aberration render-to-texture — are *structural*:
 * `setStructure` rebuilds the output node when the quality preset toggles
 * them, so Low never pays for passes it has switched off.
 *
 * `three/webgpu` is ~800 kB, so this module is only reached through
 * `loadNodePost()` (see nodePostLoader.ts), which the node renderer awaits.
 */
import * as THREE from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  clamp,
  convertToTexture,
  dot,
  float,
  floor,
  fract,
  int,
  length,
  max,
  mix,
  normalize,
  pass,
  perspectiveDepthToViewZ,
  screenUV,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import type { PostFrameParams } from './postFrameParams';

type NodeHandle = ReturnType<typeof float>;
const nd = (u: unknown): NodeHandle => u as NodeHandle;

/** Which expensive passes are in the graph. Changing it rebuilds the output node. */
export interface NodePostStructure {
  bloom: boolean;
  ssao: boolean;
  godRays: boolean;
  chromatic: boolean;
}

export function nodePostStructureKey(s: NodePostStructure): string {
  return `${+s.bloom}${+s.ssao}${+s.godRays}${+s.chromatic}`;
}

export interface NodePostPipeline {
  readonly pipeline: RenderPipeline;
  /** Rebuild the output node if the structure changed. Returns true when it did. */
  setStructure(structure: NodePostStructure): boolean;
  /** Push one frame's parameters into the graph's uniforms. */
  update(params: PostFrameParams): void;
  render(): void;
  dispose(): void;
}

interface Disposable {
  dispose(): void;
}

/** GTAO runs at half resolution — the JSM SSAOPass's cost class, not full-res. */
const AO_RESOLUTION_SCALE = 0.5;
/** View distance (m) over which AO fades to none. */
const AO_FADE_START = 40;
const AO_FADE_END = 80;
/** Upper bound of the god-ray march; `samples` breaks out earlier (uniformly). */
const GOD_RAY_MAX_SAMPLES = 64;

export function createNodePostPipeline(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  initial: NodePostStructure,
): NodePostPipeline {
  const pipeline = new RenderPipeline(renderer);

  // ── Uniforms (one set, shared across structure rebuilds) ─────────────────
  const u = {
    bloomStrength: uniform(0.5),
    bloomRadius: uniform(0.5),
    bloomThreshold: uniform(0.8),
    saturation: uniform(0),
    chromaticAmount: uniform(0.001),
    chromaticCenter: uniform(new THREE.Vector2(0.5, 0.5)),
    chromaticRadius: uniform(0.8),
    vignetteOffset: uniform(0.35),
    vignetteDarkness: uniform(0.5),
    vignetteEnabled: uniform(1),
    godRaysIntensity: uniform(0),
    sunScreenPosition: uniform(new THREE.Vector2(0.5, 0.2)),
    sunColor: uniform(new THREE.Color('#fff4e0')),
    rayLength: uniform(0.4),
    samples: uniform(16, 'int'),
    decay: uniform(0.95),
    exposure: uniform(0.18),
    density: uniform(0.96),
    wallOcclusion: uniform(0.9),
    time: uniform(0),
    rainbowIntensity: uniform(0),
    aspectRatio: uniform(1),
    // The scene camera's clip planes; the pipeline quad renders with its own camera.
    cameraNear: uniform(0.1),
    cameraFar: uniform(1000),
  };

  // The scene pass is structure-independent: build it once. Single-sampled,
  // like the JSM composer's targets: GTAO and the god-ray march sample its
  // depth, and a multisampled depth texture cannot be sampled on native WebGPU.
  const scenePass = pass(scene, camera, { samples: 0 });
  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');

  // ── God rays — port of GOD_RAYS_FRAGMENT_SHADER (VolumetricGodRays.tsx) ──
  // Control flow stays uniform (loop bound + break come from uniforms; the
  // off-screen early-out is a mask, not a break) so WGSL accepts the texture
  // samples inside the loop.
  const hash = Fn(([p]: [NodeHandle]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
  const valueNoise = Fn(([p]: [NodeHandle]) => {
    const i = floor(p);
    const f = fract(p).toVar();
    f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
    return mix(
      mix(hash(i), hash(i.add(vec2(1, 0))), f.x),
      mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), f.x),
      f.y,
    );
  });

  const godRays = Fn(() => {
    const result = vec3(0).toVar();
    If(nd(u.godRaysIntensity).greaterThan(0), () => {
      const uv = screenUV;
      const delta = nd(u.sunScreenPosition).sub(uv);
      const dist = length(delta);
      const direction = normalize(delta.add(vec2(1e-6, 0)));
      const currentDepth = sceneDepth.sample(uv).r;
      const samplesF = max(float(nd(u.samples)), 1.0);
      const sampleDist = nd(u.rayLength).div(samplesF);
      const samplePos = vec2(uv).toVar();
      const sampleWeight = float(1).toVar();
      const inside = float(1).toVar();
      const illumination = float(0).toVar();

      Loop({ start: int(0), end: int(GOD_RAY_MAX_SAMPLES), type: 'int', condition: '<' }, ({ i }: { i: NodeHandle }) => {
        If(i.greaterThanEqual(nd(u.samples)), () => {
          Break();
        });
        samplePos.addAssign(direction.mul(sampleDist));
        inside.mulAssign(
          step(0.0, samplePos.x).mul(step(samplePos.x, 1.0)).mul(step(0.0, samplePos.y)).mul(step(samplePos.y, 1.0)),
        );
        const sampleUv = clamp(samplePos, 0.0, 1.0);
        const luminance = dot(sceneColor.sample(sampleUv).rgb, vec3(0.299, 0.587, 0.114));
        const sampleDepth = sceneDepth.sample(sampleUv).r;
        const t = nd(u.time);
        const mistNoise = valueNoise(sampleUv.mul(8.0).add(vec2(t.mul(0.02), t.mul(-0.01)))).mul(0.5).add(0.5);
        const depthDelta = abs(sampleDepth.sub(currentDepth));
        const edgeAttenuation = float(1).sub(smoothstep(0.008, 0.085, depthDelta).mul(nd(u.wallOcclusion)));
        const mistDensity = nd(u.density).mul(mistNoise).mul(edgeAttenuation);
        illumination.addAssign(luminance.mul(sampleWeight).mul(mistDensity).mul(inside));
        sampleWeight.mulAssign(nd(u.decay));
      });

      const lit = clamp(illumination.mul(nd(u.exposure).div(samplesF)), 0.0, 1.0);
      const sunFade = smoothstep(1.0, 0.15, dist);
      // The JSM pass blends `vec4(rayColor, a)` additively (src + dst), so the
      // composite contribution is rayColor itself.
      result.assign(nd(u.sunColor).mul(lit).mul(nd(u.godRaysIntensity)).mul(sunFade).mul(step(0.0005, dist)));
    });
    return result;
  });

  // ── Per-pixel grading (always in the graph; inert at neutral uniforms) ────
  // HueSaturationShader with hue = 0 (the only value the stack uses).
  const hueSaturation = Fn(([color]: [NodeHandle]) => {
    const rgb = color.rgb.toVar();
    const average = rgb.r.add(rgb.g).add(rgb.b).div(3.0);
    const sat = nd(u.saturation);
    If(sat.greaterThan(0.0), () => {
      rgb.addAssign(average.sub(rgb).mul(float(1.0).sub(float(1.0).div(float(1.001).sub(sat)))));
    }).Else(() => {
      rgb.addAssign(average.sub(rgb).mul(sat.negate()));
    });
    return vec4(rgb, color.a);
  });

  // CHROMATIC_ABERRATION_SHADER: radial RGB split, strongest at the centre.
  const chromatic = Fn(([tex]: [ReturnType<typeof convertToTexture>]) => {
    const uv = screenUV;
    const delta = uv.sub(nd(u.chromaticCenter));
    const dist = length(delta);
    const direction = normalize(delta.add(vec2(1e-6, 0)));
    const factor = float(1.0).sub(dist.div(nd(u.chromaticRadius))).mul(nd(u.chromaticAmount)).max(0.0);
    const r = tex.sample(uv.add(direction.mul(factor))).r;
    const g = tex.sample(uv).g;
    const b = tex.sample(uv.sub(direction.mul(factor))).b;
    return vec4(r, g, b, 1.0);
  });

  // VignetteShader.
  const vignette = Fn(([color]: [NodeHandle]) => {
    const v = screenUV.sub(0.5).mul(nd(u.vignetteOffset));
    const graded = mix(color.rgb, vec3(float(1.0).sub(nd(u.vignetteDarkness))), dot(v, v));
    return vec4(mix(color.rgb, graded, nd(u.vignetteEnabled)), color.a);
  });

  // RAINBOW_SHADER: waterfall-mist prismatic arc.
  const hue2rgb = Fn(([hIn]: [NodeHandle]) => {
    const h = fract(hIn);
    const r = abs(h.mul(6.0).sub(3.0)).sub(1.0);
    const g = float(2.0).sub(abs(h.mul(6.0).sub(2.0)));
    const b = float(2.0).sub(abs(h.mul(6.0).sub(4.0)));
    return clamp(vec3(r, g, b), 0.0, 1.0);
  });
  const rainbow = Fn(([color]: [NodeHandle]) => {
    const out = vec4(color).toVar();
    If(nd(u.rainbowIntensity).greaterThanEqual(0.005), () => {
      // RAINBOW_SHADER works in bottom-left vUv; screenUV is top-left.
      const uv = vec2(screenUV.x, float(1.0).sub(screenUV.y));
      const delta = uv.sub(vec2(0.5, 0.52)).mul(vec2(nd(u.aspectRatio), 1.0));
      const dist = length(delta);
      const inner = float(0.2);
      const outer = float(0.37);
      const band = smoothstep(inner.sub(0.03), inner, dist).mul(smoothstep(outer.add(0.03), outer, dist));
      const arcMask = smoothstep(0.06, -0.04, delta.y.div(max(dist, 0.001)));
      const t = clamp(dist.sub(inner).div(max(outer.sub(inner), 0.001)), 0.0, 1.0);
      const spectral = hue2rgb(float(1.0).sub(t).mul(0.75));
      const shimmer = float(0.8).add(sin(nd(u.time).mul(2.5).add(dist.mul(24.0))).mul(0.2));
      const amount = band.mul(arcMask).mul(shimmer).mul(nd(u.rainbowIntensity)).mul(0.28);
      out.assign(vec4(color.rgb.add(spectral.mul(amount)), color.a));
    });
    return out;
  });

  // ── Structure ────────────────────────────────────────────────────────────
  let owned: Disposable[] = [];
  let structureKey = '';

  const build = (s: NodePostStructure) => {
    for (const node of owned) node.dispose();
    owned = [];

    let color: NodeHandle = nd(sceneColor);

    if (s.ssao) {
      // Normals are reconstructed from depth (no MRT), so every scene material
      // — including the project's custom node materials — works unchanged.
      const aoPass = ao(sceneDepth, null, camera);
      aoPass.resolutionScale = AO_RESOLUTION_SCALE;
      owned.push(aoPass as unknown as Disposable);
      // Raw GTAO carries its per-pixel noise pattern; the JSM SSAOPass blurs
      // its output too.
      const aoDenoised = denoise(aoPass.getTextureNode(), sceneDepth, null, camera);
      owned.push(aoDenoised as unknown as Disposable);
      // Depth-reconstructed normals fall apart at range — the sky dome and
      // far walls band into stripes, and GTAO leaves far-plane pixels
      // unwritten — so AO fades out with view distance. It is for contact
      // shadows in crevices, which are all near the player.
      const viewDistance = perspectiveDepthToViewZ(sceneDepth.r, nd(u.cameraNear), nd(u.cameraFar)).negate();
      const fade = smoothstep(AO_FADE_START, AO_FADE_END, viewDistance);
      const occlusion = mix(nd(aoDenoised).r, float(1), fade);
      color = vec4(color.rgb.mul(occlusion), color.a);
    }

    if (s.godRays) {
      color = vec4(color.rgb.add(godRays()), color.a);
    }

    if (s.bloom) {
      // BloomNode adopts node arguments as-is, so the long-lived uniforms keep
      // their per-frame writes across structure rebuilds.
      type BloomArg = Parameters<typeof bloom>[1];
      const bloomPass = bloom(
        color,
        u.bloomStrength as unknown as BloomArg,
        u.bloomRadius as unknown as BloomArg,
        u.bloomThreshold as unknown as BloomArg,
      );
      owned.push(bloomPass as unknown as Disposable);
      color = vec4(color.rgb.add(nd(bloomPass).rgb), color.a);
    }

    color = hueSaturation(color);

    if (s.chromatic) {
      const tex = convertToTexture(color);
      owned.push(tex);
      color = chromatic(tex);
    }

    color = rainbow(vignette(color));

    pipeline.outputNode = color;
    pipeline.needsUpdate = true;
  };

  const setStructure = (s: NodePostStructure) => {
    const key = nodePostStructureKey(s);
    if (key === structureKey) return false;
    structureKey = key;
    build(s);
    return true;
  };

  setStructure(initial);

  return {
    pipeline,
    setStructure,
    update(params) {
      u.bloomStrength.value = params.bloom.strength;
      u.bloomRadius.value = params.bloom.radius;
      u.bloomThreshold.value = params.bloom.threshold;
      u.saturation.value = params.hueSaturation.saturation;
      u.chromaticAmount.value = params.chromatic.amount;
      u.vignetteOffset.value = params.vignette.offset;
      u.vignetteDarkness.value = params.vignette.darkness;
      u.vignetteEnabled.value = params.vignette.enabled ? 1 : 0;

      const g = params.godRays;
      u.godRaysIntensity.value = g.enabled ? g.intensity : 0;
      u.sunScreenPosition.value.copy(g.sunScreenPosition);
      u.sunColor.value.copy(g.sunColor);
      u.rayLength.value = g.rayLength;
      u.samples.value = Math.min(GOD_RAY_MAX_SAMPLES, Math.max(1, Math.round(g.samples)));
      u.decay.value = g.decay;
      u.exposure.value = g.exposure;
      u.density.value = g.density;
      u.wallOcclusion.value = g.wallOcclusion;
      u.time.value = g.time;

      const clip = camera as THREE.PerspectiveCamera;
      if (typeof clip.near === 'number') u.cameraNear.value = clip.near;
      if (typeof clip.far === 'number') u.cameraFar.value = clip.far;

      u.rainbowIntensity.value = params.rainbow.intensity;
      u.aspectRatio.value = params.rainbow.aspectRatio;
    },
    render() {
      pipeline.render();
    },
    dispose() {
      for (const node of owned) node.dispose();
      owned = [];
      scenePass.dispose();
      pipeline.dispose();
    },
  };
}
