import * as THREE from 'three';
import { createGameRenderer, type GameRenderer, type GameRendererOptions } from './createRenderer';
import {
  deriveRendererContextOptions,
  type RendererContextOptions,
} from './deriveRendererContextOptions';
import type { QualityPreset } from '../systems/GameState';

/** Preset the boot fallback lands on. `low` is the weak-machine contract. */
export const CAVEAT_FALLBACK_PRESET: QualityPreset = 'low';

export interface CaveatFallbackInfo {
  /** Preset whose context request failed. */
  from: QualityPreset;
  /** Preset the retry succeeded at — always `CAVEAT_FALLBACK_PRESET`. */
  to: QualityPreset;
  /** The original construction failure, for logging. */
  error: unknown;
}

export interface CaveatFallbackInput {
  /** Preset the Canvas is currently mounted at. */
  quality: QualityPreset;
  /** Options derived for `quality` — the attempt that may fail. */
  contextOptions: RendererContextOptions;
  /** `window.devicePixelRatio` at derive time; injected for tests. */
  devicePixelRatio?: number;
  /** Everything else `createGameRenderer` needs (preference, materialBackend, …). */
  rendererOptions: Omit<GameRendererOptions, 'contextOptions' | 'antialias' | 'powerPreference'>;
  /** Called once, before the retry, when a caveat failure is being downgraded. */
  onCaveatFallback?: (info: CaveatFallbackInfo) => void;
  /** Seam for tests. Defaults to the real factory. */
  createRenderer?: typeof createGameRenderer;
}

const toRendererOptions = (
  input: CaveatFallbackInput,
  contextOptions: RendererContextOptions
): GameRendererOptions => ({
  ...input.rendererOptions,
  antialias: contextOptions.antialias,
  powerPreference: contextOptions.powerPreference,
  contextOptions,
});

/**
 * Create the game renderer, retrying once at `low` if the context request was
 * rejected for `failIfMajorPerformanceCaveat` (#397).
 *
 * The contract has always said a failed caveat request should be retried at a
 * lower preset; nothing implemented it, so a weak GPU got an exception out of
 * the async `gl` factory and the player got the error boundary instead of a
 * game. `low` is the only preset that relaxes the caveat check, so there is no
 * point stepping down one preset at a time — a machine the browser flags as a
 * major performance caveat fails identically at `high` and `medium`. One retry,
 * straight to `low`.
 *
 * The retry only fires when the failed attempt actually had the caveat check on.
 * A `low` (or `?softwareGl=1` / capture-mode) failure is a genuine "no WebGL
 * here" and is rethrown, so the error boundary still reports it.
 *
 * Note this does *not* itself remount the Canvas. It returns a working renderer
 * for the current mount; `onCaveatFallback` is what moves the quality setting,
 * and the resulting Canvas identity key change is what remounts — once — with
 * `low`'s DPR, shadows, and props in agreement.
 */
export async function createGameRendererWithCaveatFallback(
  canvasProps: THREE.WebGLRendererParameters,
  input: CaveatFallbackInput
): Promise<GameRenderer> {
  const create = input.createRenderer ?? createGameRenderer;

  try {
    return await create(canvasProps, toRendererOptions(input, input.contextOptions));
  } catch (error) {
    if (!input.contextOptions.failIfMajorPerformanceCaveat) throw error;

    const fallbackOptions = deriveRendererContextOptions(CAVEAT_FALLBACK_PRESET, {
      devicePixelRatio: input.devicePixelRatio ?? 1,
      // `low` derives `failIfMajorPerformanceCaveat: false` on its own; passing
      // the flag explicitly keeps that true even if the preset table moves.
      allowSoftwareFallback: true,
    });

    console.warn(
      `[Renderer] WebGL context request failed at "${input.quality}" ` +
        `(failIfMajorPerformanceCaveat) — retrying once at "${CAVEAT_FALLBACK_PRESET}".`,
      error
    );

    input.onCaveatFallback?.({
      from: input.quality,
      to: CAVEAT_FALLBACK_PRESET,
      error,
    });

    return create(canvasProps, toRendererOptions(input, fallbackOptions));
  }
}
