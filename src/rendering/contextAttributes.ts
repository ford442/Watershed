/**
 * Context attributes that are identical for every quality preset.
 *
 * Its own module so that both halves of the contract can read it without an
 * import cycle: `deriveRendererContextOptions` composes the renderer's options
 * from it, and `probeGraphicsCapability` needs it to ask the *same* question the
 * renderer will later ask. A probe that requests a different attribute set than
 * `THREE.WebGLRenderer` is a probe that can pass while the real context request
 * fails — the old bug, with extra latency.
 *
 * - `alpha: false` — an opaque game view. THREE always *requests* the GL context
 *   with `alpha: true` (r178), so this does not change the context itself; what
 *   it changes is `WebGLBackground`, which then clears the drawing buffer fully
 *   opaque instead of letting the page show through. Matches THREE's default;
 *   pinned so it cannot drift silently. Native WebGPU is the exception: there
 *   `alpha` *is* the canvas `alphaMode`, so that path passes `alpha: true`
 *   (premultiplied) and clears opaque itself — see `nativeWebGPURendererParameters`.
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
 * The context name THREE r178 asks for. WebGL1 is not a fallback anywhere in
 * this codebase — the shaders are GLSL ES 3.00.
 */
export const GL_CONTEXT_NAME = 'webgl2';

/**
 * The attribute object `THREE.WebGLRenderer` (0.185) builds from its constructor
 * parameters and hands to `getContext` — its defaults, its hardcoded
 * `alpha: true`, nothing else.
 *
 * The node renderer's WebGL2 backend builds a *different* object (antialias from
 * its internal sample count, no power preference, no caveat flag, no
 * preserveDrawingBuffer). So on `?material=tsl` the context is created here,
 * from this object, and passed in as `context` — one context, the probed one.
 */
export function webGLContextAttributesFor(parameters: {
  depth?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: WebGLPowerPreference;
  failIfMajorPerformanceCaveat?: boolean;
}): WebGLContextAttributes {
  return {
    alpha: true,
    depth: parameters.depth ?? true,
    stencil: parameters.stencil ?? false,
    antialias: parameters.antialias ?? false,
    premultipliedAlpha: parameters.premultipliedAlpha ?? true,
    preserveDrawingBuffer: parameters.preserveDrawingBuffer ?? false,
    powerPreference: parameters.powerPreference ?? 'default',
    failIfMajorPerformanceCaveat: parameters.failIfMajorPerformanceCaveat ?? false,
  };
}
