import * as THREE from 'three';
import type { QualityPreset } from '../systems/GameState';
import { SHARED_CONTEXT_ATTRIBUTES } from './contextAttributes';
import { RENDER_SCALE_MAX, clampRenderScale } from './renderScale';
import {
  CAPTURE_ENVELOPE,
  HARDWARE_ENVELOPE,
  type GraphicsEnvelope,
} from './probeGraphicsCapability';

export { SHARED_CONTEXT_ATTRIBUTES };

/** Shadow mode mapped to R3F Canvas `shadows` prop and THREE.ShadowMapType. */
export type ShadowMode = 'off' | 'basic' | 'soft';

export interface RendererContextSettings {
  /** Browser `window.devicePixelRatio`; inject in tests. Defaults to 1. */
  devicePixelRatio?: number;
  /**
   * The session's frozen context envelope, from `negotiateBootGraphics()`.
   *
   * Antialias, power preference, and the caveat flag are creation-time
   * attributes: changing one needs a new WebGL context, i.e. a Canvas remount,
   * i.e. a Rapier teardown. They are therefore negotiated once at boot and
   * passed in here, identically for every preset — which is what keeps
   * `rendererContextCreationKey()` stable across a quality change.
   *
   * Defaults to `HARDWARE_ENVELOPE` so callers that only care about the
   * live-applicable half (tests, LOD tables) do not have to thread a probe.
   */
  envelope?: GraphicsEnvelope;
  /**
   * Adaptive render scale — a 0.5–1.0 multiplier on the preset's `dprMax`
   * (#419 phase C). Driven by measured frame time in `LODManager`, applied live
   * through the R3F `dpr` prop and `RendererQualitySync`.
   *
   * The preset is the ceiling, this is the valve. Defaults to
   * `RENDER_SCALE_MAX`, so every caller that does not opt in (the editor, the
   * LOD tables, tests) gets exactly the pre-valve numbers.
   */
  renderScale?: number;
}

export interface RendererContextOptions {
  /**
   * Upper bound for Canvas DPR — clamp device pixel ratio to [1, dprMax].
   *
   * This is the preset ceiling already multiplied by `renderScale`, so it is
   * the single number the Canvas and the renderer need. It can drop below 1
   * when the valve is closed on a `low` / `medium` preset.
   */
  dprMax: number;
  /**
   * The valve position this `dprMax` was derived with (1.0 = wide open).
   *
   * Carried on the options purely so diagnostics and the live-apply path can
   * report it. It is **not** part of `rendererContextCreationKey()` — a scale
   * change must never remount the Canvas.
   */
  renderScale: number;
  antialias: boolean;
  shadowMode: ShadowMode;
  /** Null when shadows are disabled. */
  shadowMapSize: number | null;
  powerPreference: WebGLPowerPreference;
  outputColorSpace: THREE.ColorSpace;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  /** Opaque game view — the drawing buffer is cleared with alpha 1. */
  alpha: boolean;
  /** Blend-function convention for transparent materials. */
  premultipliedAlpha: boolean;
  /** Depth buffer — required by every 3D pass and by SSAO. */
  depth: boolean;
  /** Stencil buffer — reserved for outline / mask passes. */
  stencil: boolean;
  /** Reject software GL (SwiftShader) unless explicitly opted out. */
  failIfMajorPerformanceCaveat: boolean;
}

/**
 * Attributes fixed at context-creation time. Changing any of them requires a
 * brand-new WebGL context, i.e. a Canvas remount; everything else in
 * `RendererContextOptions` can be applied live. `rendererContextCreationKey()`
 * turns exactly this set into the Canvas `key`.
 */
export type RendererCreationAttributes = Pick<
  RendererContextOptions,
  | 'antialias'
  | 'alpha'
  | 'premultipliedAlpha'
  | 'depth'
  | 'stencil'
  | 'failIfMajorPerformanceCaveat'
  | 'powerPreference'
>;

/** Default ACES exposure — matches THREE.WebGLRenderer default of 1.0. */
export const DEFAULT_TONE_MAPPING_EXPOSURE = 1.0;

/**
 * Logarithmic depth is intentionally off for all presets.
 *
 * Evaluated for long canyon Z ranges (#337): the track treadmill keeps only
 * ~7 active segments (~hundreds of units of Z), fog far is typically ≤220, and
 * shadow cameras use far=200. Enabling `logarithmicDepthBuffer` would require
 * log-depth chunks in every custom ShaderMaterial (FlowingWater, CanyonMaterial,
 * RiverShader injections) for modest Z-fighting benefit. Keep the THREE default
 * (false); revisit only if a non-treadmill long-haul camera path ships.
 */
export const LOGARITHMIC_DEPTH_BUFFER_ENABLED = false;

/**
 * `desynchronized` is intentionally not part of the contract.
 *
 * THREE r168's `WebGLRenderer` builds its own `getContext` attribute object and
 * never forwards `desynchronized`, so setting it here would be decoration, not
 * configuration. It is also the wrong trade for this game: low-latency
 * presentation can tear and reorders readback, which `?screenshot=1` depends on.
 * Revisit only alongside a renderer that actually exposes the attribute.
 */
export const DESYNCHRONIZED_ENABLED = false;

/**
 * Hard ceiling on `ultra`'s DPR clamp.
 *
 * `ultra` renders at the display's native `devicePixelRatio`, which used to be
 * uncapped. On a 3x phone or a 4x external panel that is 9–16x the pixel work of
 * DPR 1 — enough to miss the 60 FPS / 16.67 ms budget on hardware that is
 * otherwise comfortably an `ultra` machine, and the player reads it as "ultra is
 * broken" rather than "ultra is oversampling".
 *
 * 2.0 is shipping practice (<=2.0 desktop, 1.5–2.0 mobile): DPR 2 is the full
 * retina win, and 3–4x panels are a fill-rate trap rather than a quality tier.
 *
 * This is the quality *ceiling*, not the valve. The valve is the frame-time
 * driven render scale in `renderScale.ts`, which multiplies this ceiling down
 * to 0.5x while the game runs. Raising this constant is still a real
 * performance decision — a machine that drops frames needs resolution to come
 * *down* under load, not the ceiling to move up — so it must move here, in
 * RENDERER.md, and in the test that pins it.
 */
export const ULTRA_DPR_CEILING = 2.0;

/**
 * Pure quality → WebGL context options. No React or DOM side effects.
 *
 * The preset decides only what can be applied to a *live* renderer: the DPR
 * clamp, the shadow mode, and the shadow map size. Every creation-time
 * attribute comes from the session's frozen `envelope`, so all four presets
 * produce the same `rendererContextCreationKey()` and the Canvas is never
 * remounted by a quality change.
 *
 * `settings.renderScale` multiplies the preset's DPR ceiling (#419 phase C).
 * It is a live knob like the ceiling itself, so it changes `dprMax` and nothing
 * else: shadow mode, shadow map size, tone mapping, and every creation-time
 * attribute are untouched by the valve.
 *
 * `high` matches the pre-contract Canvas defaults: soft shadows, DPR clamped to
 * [1, 2], 2048 shadow maps.
 */
export function deriveRendererContextOptions(
  quality: QualityPreset,
  settings: RendererContextSettings = {}
): RendererContextOptions {
  const devicePixelRatio = settings.devicePixelRatio ?? 1;
  const envelope = settings.envelope ?? HARDWARE_ENVELOPE;
  const renderScale = clampRenderScale(settings.renderScale ?? RENDER_SCALE_MAX);

  const base = {
    ...SHARED_CONTEXT_ATTRIBUTES,
    // Frozen at boot by the graphics probe — never preset-dependent.
    antialias: envelope.antialias,
    powerPreference: envelope.powerPreference,
    failIfMajorPerformanceCaveat: envelope.failIfMajorPerformanceCaveat,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: DEFAULT_TONE_MAPPING_EXPOSURE,
    renderScale,
  };

  // The preset's own ceiling, before the valve. `scaled()` is applied on the way
  // out so the valve can never be forgotten on one branch of the switch.
  const scaled = (presetDprMax: number): number =>
    Math.round(presetDprMax * renderScale * 1000) / 1000;

  switch (quality) {
    case 'low':
      return {
        ...base,
        dprMax: scaled(1.0),
        shadowMode: 'off',
        shadowMapSize: null,
      };
    case 'medium':
      return {
        ...base,
        dprMax: scaled(1.25),
        shadowMode: 'basic',
        shadowMapSize: 1024,
      };
    case 'high':
      return {
        ...base,
        dprMax: scaled(2),
        shadowMode: 'soft',
        shadowMapSize: 2048,
      };
    case 'ultra':
      return {
        ...base,
        dprMax: scaled(Math.min(devicePixelRatio, ULTRA_DPR_CEILING)),
        shadowMode: 'soft',
        // Keyed off the *raw* device pixel ratio, not the capped DPR, and never
        // off the valve: a 3x display still wants the bigger shadow map even
        // though we render below its native resolution, and closing the valve
        // for a rough patch must not reallocate every shadow map.
        shadowMapSize: devicePixelRatio >= 2 ? 4096 : 2048,
      };
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}

/** R3F Canvas `shadows` prop value from derived shadow mode. */
export function shadowModeToCanvasProp(
  mode: ShadowMode
): false | 'basic' | 'soft' {
  if (mode === 'off') return false;
  return mode;
}

/**
 * Resolved Canvas DPR: clamp device pixel ratio to [1, dprMax].
 *
 * `dprMax` wins when the valve has pushed it below 1 — rendering at 0.6x is the
 * whole point of the valve, and a floor of 1 would silently swallow it.
 */
export function resolveCanvasDpr(
  dprMax: number,
  devicePixelRatio: number
): number {
  return Math.min(Math.max(1, devicePixelRatio), dprMax);
}

/**
 * The R3F Canvas `dpr` prop: `[min, max]`.
 *
 * The minimum used to be the literal 1. With the valve closed on a `low` or
 * `medium` preset, `dprMax` can land below 1, and `[1, 0.6]` is an inverted
 * range — R3F would still clamp to 0.6 today, but only because its clamp
 * happens to apply `max` last. Deriving the minimum keeps the range honest
 * instead of relying on that ordering.
 */
export function canvasDprRange(dprMax: number): [number, number] {
  return [Math.min(1, dprMax), dprMax];
}

/**
 * WebGL context attributes to hand the renderer constructor.
 *
 * Only creation-time attributes belong here — tone mapping, color space, and
 * shadow configuration are renderer *properties* and are applied (and re-applied
 * on quality change) by `applyRendererContextOptions` / `applyRendererQualityUpdate`.
 */
export function toContextAttributes(
  options: RendererContextOptions
): RendererCreationAttributes & { logarithmicDepthBuffer: boolean } {
  return {
    antialias: options.antialias,
    alpha: options.alpha,
    premultipliedAlpha: options.premultipliedAlpha,
    depth: options.depth,
    stencil: options.stencil,
    failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat,
    powerPreference: options.powerPreference,
    logarithmicDepthBuffer: LOGARITHMIC_DEPTH_BUFFER_ENABLED,
  };
}

/**
 * Stable string over the attributes that can only change with a new WebGL
 * context. Two presets sharing a key can be swapped live; a differing key is
 * what forces the Canvas remount.
 *
 * Since boot-time negotiation, **all four presets share one key**: the
 * attributes serialized here come from the session's frozen `GraphicsEnvelope`,
 * not from the preset. The preset only moves DPR, shadow mode, and shadow map
 * size, all of which apply live. A quality change therefore cannot remount the
 * Canvas, cannot destroy the WebGL context, and cannot re-initialise Rapier.
 *
 * The render scale is absent for the same reason the preset is: it moves
 * `dprMax`, which `renderer.setPixelRatio` applies to a live context. A valve
 * that remounted the Canvas every time frame time wobbled would be worse than
 * no valve at all. Pinned by a test.
 *
 * What can still change the key: the envelope itself (only ever decided once,
 * at boot — `?softwareGl=1` and the capture harness pin their own), the renderer
 * class, the material backend, and the context-loss epoch.
 */
export function rendererContextCreationKey(
  options: RendererContextOptions
): string {
  return [
    `aa:${options.antialias ? 1 : 0}`,
    `alpha:${options.alpha ? 1 : 0}`,
    `pma:${options.premultipliedAlpha ? 1 : 0}`,
    `depth:${options.depth ? 1 : 0}`,
    `stencil:${options.stencil ? 1 : 0}`,
    `caveat:${options.failIfMajorPerformanceCaveat ? 1 : 0}`,
    `power:${options.powerPreference}`,
  ].join('|');
}

/**
 * Quality preset the in-game Level Editor renders at.
 *
 * The editor is an authoring tool on a desktop, not a run: it wants the default
 * look (`high`) rather than whatever the player last picked for performance.
 */
export const EDITOR_QUALITY_PRESET: QualityPreset = 'high';

/**
 * Renderer contract for the Level Editor and any other non-gameplay Canvas.
 *
 * Same derive function as the game so a change to the contract cannot miss the
 * editor, with one deliberate difference: it pins `CAPTURE_ENVELOPE`, which
 * keeps the caveat check off. The editor is a tool — running it on a machine
 * without a real GPU should be slow, not impossible — and it boots its own
 * Canvas without going through the game's boot negotiation.
 */
export function deriveEditorContextOptions(
  settings: RendererContextSettings = {}
): RendererContextOptions {
  return deriveRendererContextOptions(EDITOR_QUALITY_PRESET, {
    devicePixelRatio:
      settings.devicePixelRatio ??
      (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
    envelope: settings.envelope ?? CAPTURE_ENVELOPE,
  });
}

export interface CanvasIdentityInput {
  rendererPreference: string;
  materialBackend: string;
  contextOptions: RendererContextOptions;
  /** Bumped on `webglcontextrestored` to force a clean remount. */
  epoch: number;
}

/**
 * The React `key` of the game Canvas — i.e. everything whose change must tear
 * down and rebuild the scene graph.
 *
 * Deliberately *not* in here: the quality preset. Before this, the preset was
 * part of the key, so dropping from `ultra` to `medium` mid-run destroyed
 * Rapier, the 7-segment treadmill, the WASM SWE grids, audio, and the vehicle
 * body — the player's only performance lever cost them their run. DPR, shadow
 * mode, and shadow map size are all applied live instead (RendererQualitySync,
 * SceneLighting, the R3F `dpr`/`shadows` props).
 *
 * What remains is: the renderer class (`rendererPreference`), the material
 * pipeline (`materialBackend`), the creation-only context attributes, and the
 * context-loss epoch. Antialias used to be the exception that made `low` ↔
 * anything remount; it is now part of the boot-negotiated envelope, so no preset
 * transition changes this key at all.
 */
export function buildCanvasIdentityKey(input: CanvasIdentityInput): string {
  return [
    `renderer-${input.rendererPreference}`,
    `material-${input.materialBackend}`,
    `ctx-${rendererContextCreationKey(input.contextOptions)}`,
    `epoch-${input.epoch}`,
  ].join('-');
}
