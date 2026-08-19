import * as THREE from 'three';
import type { QualityPreset } from '../systems/GameState';

/** Shadow mode mapped to R3F Canvas `shadows` prop and THREE.ShadowMapType. */
export type ShadowMode = 'off' | 'basic' | 'soft';

export interface RendererContextSettings {
  /** Browser `window.devicePixelRatio`; inject in tests. Defaults to 1. */
  devicePixelRatio?: number;
  /**
   * Opt out of `failIfMajorPerformanceCaveat`. Visual-smoke / `?screenshot=1` /
   * CI run headless Chromium on SwiftShader, which *is* a major performance
   * caveat — without this the context request fails and the harness sees a
   * black canvas. Production never sets it. See `isSoftwareRendererAllowed()`.
   */
  allowSoftwareFallback?: boolean;
}

export interface RendererContextOptions {
  /** Upper bound for Canvas DPR — clamp device pixel ratio to [1, dprMax]. */
  dprMax: number;
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
 * Context attributes that are identical for every quality preset.
 *
 * - `alpha: false` — an opaque game view. THREE always *requests* the GL context
 *   with `alpha: true` (r168), so this does not change the context itself; what
 *   it changes is `WebGLBackground`, which then clears the drawing buffer fully
 *   opaque instead of letting the page show through. Matches THREE's default;
 *   pinned so it cannot drift silently.
 * - `premultipliedAlpha: true` — THREE's default, and *not* only a compositing
 *   concern: `WebGLState.setBlending` picks premultiplied blend functions from
 *   this flag, so every transparent material in the game (splash particles,
 *   water, weather, VFX) is authored against `true`. Flipping it to `false`
 *   would change how all of them blend. Pinned at the value the content assumes.
 * - `depth: true` — THREE's default; required by every 3D pass and by SSAO.
 * - `stencil: true` — NOT THREE's default (r163+ turns it off). Enabled here for
 *   the post stack's mask/outline passes; costs a stencil attachment.
 */
export const SHARED_CONTEXT_ATTRIBUTES = {
  alpha: false,
  premultipliedAlpha: true,
  depth: true,
  stencil: true,
} as const;

/**
 * Pure quality → WebGL context options. No React or DOM side effects.
 *
 * `high` matches the pre-contract Canvas defaults: antialias on, soft shadows,
 * DPR clamped to [1, 2], high-performance power preference.
 */
export function deriveRendererContextOptions(
  quality: QualityPreset,
  settings: RendererContextSettings = {}
): RendererContextOptions {
  const devicePixelRatio = settings.devicePixelRatio ?? 1;

  // Software GL (SwiftShader) must not silently masquerade as a shipped GPU:
  // at `low` we still accept it, because `low` is the fallback a weak machine
  // is meant to land on. Above `low` the context request fails instead, and the
  // caller can retry at a lower preset.
  const allowSoftwareFallback = settings.allowSoftwareFallback ?? false;

  const base = {
    ...SHARED_CONTEXT_ATTRIBUTES,
    powerPreference: 'high-performance' as WebGLPowerPreference,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: DEFAULT_TONE_MAPPING_EXPOSURE,
  };

  const failIfMajorPerformanceCaveat = quality !== 'low' && !allowSoftwareFallback;

  switch (quality) {
    case 'low':
      return {
        ...base,
        failIfMajorPerformanceCaveat,
        dprMax: 1.0,
        antialias: false,
        shadowMode: 'off',
        shadowMapSize: null,
      };
    case 'medium':
      return {
        ...base,
        failIfMajorPerformanceCaveat,
        dprMax: 1.25,
        antialias: true,
        shadowMode: 'basic',
        shadowMapSize: 1024,
      };
    case 'high':
      return {
        ...base,
        failIfMajorPerformanceCaveat,
        dprMax: 2,
        antialias: true,
        shadowMode: 'soft',
        shadowMapSize: 2048,
      };
    case 'ultra':
      return {
        ...base,
        failIfMajorPerformanceCaveat,
        dprMax: devicePixelRatio,
        antialias: true,
        shadowMode: 'soft',
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

/** Resolved Canvas DPR: clamp device pixel ratio to [1, dprMax]. */
export function resolveCanvasDpr(
  dprMax: number,
  devicePixelRatio: number
): number {
  return Math.min(Math.max(1, devicePixelRatio), dprMax);
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
 * Today that means `medium` / `high` / `ultra` share one key (they differ only
 * in DPR and shadow configuration, both live-applicable), while `low` gets its
 * own — it turns antialias off and accepts software GL.
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
 * editor, with one deliberate difference: software GL is allowed. The editor is
 * a tool — running it on a machine without a real GPU should be slow, not
 * impossible.
 */
export function deriveEditorContextOptions(
  settings: RendererContextSettings = {}
): RendererContextOptions {
  return deriveRendererContextOptions(EDITOR_QUALITY_PRESET, {
    devicePixelRatio:
      settings.devicePixelRatio ??
      (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
    allowSoftwareFallback: settings.allowSoftwareFallback ?? true,
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
 * context-loss epoch. Antialias is the one quality-driven attribute that cannot
 * change on a live context, which is why `low` ↔ anything still remounts.
 */
export function buildCanvasIdentityKey(input: CanvasIdentityInput): string {
  return [
    `renderer-${input.rendererPreference}`,
    `material-${input.materialBackend}`,
    `ctx-${rendererContextCreationKey(input.contextOptions)}`,
    `epoch-${input.epoch}`,
  ].join('-');
}
