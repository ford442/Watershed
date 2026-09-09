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
 * The context name THREE r168 asks for. WebGL1 is not a fallback anywhere in
 * this codebase — the shaders are GLSL ES 3.00.
 */
export const GL_CONTEXT_NAME = 'webgl2';
