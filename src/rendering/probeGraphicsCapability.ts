/**
 * Boot-time graphics negotiation.
 *
 * The contract this file exists to keep: **the WebGL context envelope is
 * negotiated once, before R3F and Rapier mount, and frozen for the session.**
 *
 * Why not "try `high`, and retry at `low` when the context request fails":
 *
 * 1. A retry cannot know *why* it failed. THREE wraps context creation in a
 *    generic `Error('Error creating WebGL context.')`, and hardware acceleration
 *    disabled, a blocklisted driver, a dead GPU process, a headless browser, the
 *    per-origin live-context limit, and an actual performance caveat all look
 *    identical from there. Retrying at `low` addresses exactly one of those.
 * 2. A retry *is* a Canvas remount, and a Canvas remount unmounts `<Physics>`
 *    and re-initialises the Rapier WASM world. That is the failure mode the live
 *    quality-apply work (#373/#384) exists to remove; adding a second instance
 *    of it to recover from a weak GPU is the wrong trade.
 * 3. Modern Chrome no longer hands out SwiftShader automatically when
 *    `failIfMajorPerformanceCaveat` is false, so "retry without the caveat
 *    check" is not reliably a software-rendering fallback anymore. The relaxed
 *    attempt here is understood as *"any context at all"*, not *"a software
 *    context"* — see `DEGRADED_ENVELOPE`.
 *
 * So instead we probe a throwaway canvas, learn the answer once, and hand the
 * result to `deriveRendererContextOptions()` as a session constant. Every
 * quality preset then produces the same creation attributes, which means
 * `rendererContextCreationKey()` cannot change when the player moves the quality
 * slider — the Canvas stays mounted and the world stays alive.
 */
import { GL_CONTEXT_NAME, SHARED_CONTEXT_ATTRIBUTES } from './contextAttributes';

/** What the probe found. */
export type GraphicsTier =
  /** A context with the caveat check ON — a real GPU. */
  | 'hardware'
  /** Only the relaxed request succeeded — software GL, or a flagged driver. */
  | 'degraded'
  /** No WebGL2 context at all. The game must not mount. */
  | 'unsupported';

/**
 * The creation-time attributes that are decided at boot and never change again.
 *
 * These used to be per-preset (`low` turned antialias off, relaxed the caveat
 * check, and asked for the `'default'` adapter), which put the quality preset
 * inside the Canvas identity key and made a low↔high switch a context teardown.
 */
export interface GraphicsEnvelope {
  antialias: boolean;
  powerPreference: WebGLPowerPreference;
  /**
   * What the *successful probe attempt* asked for, replayed on the real
   * context so the renderer gets exactly the context we negotiated. It is a
   * probe input, not a quality knob.
   */
  failIfMajorPerformanceCaveat: boolean;
}

/** A real GPU: MSAA on, discrete adapter, caveat check kept on. */
export const HARDWARE_ENVELOPE: GraphicsEnvelope = {
  antialias: true,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: true,
};

/**
 * Whatever GL we could get.
 *
 * MSAA off (on a software rasteriser or a flagged driver it is the single most
 * expensive attribute we can ask for), `'default'` adapter — a machine that
 * failed the strict request is usually thermally or driver constrained, and
 * demanding the power-hungry adapter works against it — and no caveat check,
 * because that is the request that actually succeeded.
 */
export const DEGRADED_ENVELOPE: GraphicsEnvelope = {
  antialias: false,
  powerPreference: 'default',
  failIfMajorPerformanceCaveat: false,
};

/**
 * Envelope pinned by the capture harness (`?screenshot=1` / `?capture=1` /
 * `?softwareGl=1`).
 *
 * Visual smoke runs headless Chromium on SwiftShader, which *is* a major
 * performance caveat. It is not a degraded player machine — it is a harness that
 * has explicitly opted into software GL and needs deterministic pixels, so it
 * keeps the `hardware` look (antialias on) with the caveat check off, exactly
 * as the pre-negotiation code did. Probing here would flip antialias and move
 * every baseline.
 */
export const CAPTURE_ENVELOPE: GraphicsEnvelope = {
  antialias: true,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
};

/** Why we ended up on this envelope — drives the badge copy and the logs. */
export type GraphicsCapabilityReason =
  /** Strict request succeeded. */
  | 'hardware'
  /** Strict request was rejected; the relaxed one succeeded. */
  | 'caveat'
  /** Capture/software-GL harness: envelope pinned, not probed. */
  | 'capture-mode'
  /** The previous boot never reached a steady frame rate — clamped on purpose. */
  | 'previous-boot-failed'
  /** Neither request produced a context, and a bare request failed too. */
  | 'no-context'
  /**
   * A bare `getContext('webgl2')` succeeds, but not with the attributes the
   * renderer needs (depth / stencil / premultiplied alpha). Diagnostic only —
   * it changes the message on the unsupported screen, not the outcome.
   */
  | 'attributes-rejected';

export interface GraphicsCapability {
  tier: GraphicsTier;
  envelope: GraphicsEnvelope;
  reason: GraphicsCapabilityReason;
  /**
   * `WebGLContextEvent.statusMessage` from the last failed attempt.
   *
   * The only real diagnostic the platform gives for a refused context ("GPU
   * process isn't usable", "Passthrough is not supported", …). Surfaced on the
   * unsupported screen because it is the difference between a user who can fix
   * their browser flag and a user staring at a blank page.
   */
  statusMessage: string | null;
  /** False when the envelope was pinned rather than measured. */
  probed: boolean;
}

interface ProbeAttemptResult {
  ok: boolean;
  statusMessage: string | null;
}

const createDefaultCanvas = (): HTMLCanvasElement | null => {
  if (typeof document === 'undefined') return null;
  try {
    return document.createElement('canvas');
  } catch {
    return null;
  }
};

/**
 * One context request on a throwaway canvas, released immediately.
 *
 * The release matters: browsers cap live WebGL contexts per origin (8–16), and
 * a leaked probe context costs the game one of those slots for the whole
 * session — on the same machines that are already short of resources.
 */
function attemptContext(
  canvas: HTMLCanvasElement,
  attributes: WebGLContextAttributes
): ProbeAttemptResult {
  let statusMessage: string | null = null;
  const onCreationError = (event: Event) => {
    const message = (event as WebGLContextEvent).statusMessage;
    statusMessage = message ? String(message) : null;
  };

  canvas.addEventListener('webglcontextcreationerror', onCreationError);
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext(GL_CONTEXT_NAME, attributes) as WebGL2RenderingContext | null;
  } catch (error) {
    // getContext is specified not to throw, but extensions, enterprise policy
    // shims, and jsdom all disagree from time to time.
    statusMessage = statusMessage ?? (error instanceof Error ? error.message : null);
    context = null;
  } finally {
    canvas.removeEventListener('webglcontextcreationerror', onCreationError);
  }

  if (!context) return { ok: false, statusMessage };

  try {
    context.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // Losing the probe context is best-effort; the canvas is unreferenced after
    // this call either way.
  }
  return { ok: true, statusMessage: null };
}

/**
 * The exact attribute object `THREE.WebGLRenderer` will hand to `getContext`.
 *
 * Read off three r178's `WebGLRenderer` constructor: it builds its own object
 * and always requests `alpha: true` (see `contextAttributes.ts`), passes
 * `depth`, `stencil`, `antialias`, `premultipliedAlpha`, `preserveDrawingBuffer`,
 * `powerPreference` and `failIfMajorPerformanceCaveat` through, and asks for
 * `webgl2` only.
 *
 * The probe asks the same question, attribute for attribute. Anything less and
 * a green probe followed by a throw out of the `gl` factory is possible again —
 * which is the failure this whole path exists to prevent, only slower.
 *
 * `preserveDrawingBuffer` is the one value the probe pins rather than mirrors:
 * it is true only in capture mode, and capture mode does not probe at all.
 */
export function rendererContextAttributesFor(
  envelope: GraphicsEnvelope
): WebGLContextAttributes {
  return {
    // THREE hardcodes this; our `alpha: false` pin drives WebGLBackground, not
    // the context request.
    alpha: true,
    depth: SHARED_CONTEXT_ATTRIBUTES.depth,
    stencil: SHARED_CONTEXT_ATTRIBUTES.stencil,
    antialias: envelope.antialias,
    premultipliedAlpha: SHARED_CONTEXT_ATTRIBUTES.premultipliedAlpha,
    preserveDrawingBuffer: false,
    powerPreference: envelope.powerPreference,
    failIfMajorPerformanceCaveat: envelope.failIfMajorPerformanceCaveat,
  };
}

export interface GraphicsProbeInput {
  /** Test seam. Defaults to a detached `<canvas>`; null means "no DOM". */
  createCanvas?: () => HTMLCanvasElement | null;
  /**
   * Skip the optimistic strict attempt and go straight to the relaxed one.
   * Used after a boot that never reached a steady frame rate: the fast path is
   * exactly what we suspect, so do not pay for it twice.
   */
  skipStrictAttempt?: boolean;
}

/**
 * Measure what this machine will give us. Pure apart from the throwaway canvas.
 */
export function probeGraphicsCapability(input: GraphicsProbeInput = {}): GraphicsCapability {
  const createCanvas = input.createCanvas ?? createDefaultCanvas;

  const attempt = (envelope: GraphicsEnvelope): ProbeAttemptResult => {
    const canvas = createCanvas();
    if (!canvas) return { ok: false, statusMessage: null };
    return attemptContext(canvas, rendererContextAttributesFor(envelope));
  };

  const strict = input.skipStrictAttempt ? null : attempt(HARDWARE_ENVELOPE);

  if (strict?.ok) {
    return {
      tier: 'hardware',
      envelope: HARDWARE_ENVELOPE,
      reason: 'hardware',
      statusMessage: null,
      probed: true,
    };
  }

  const relaxed = attempt(DEGRADED_ENVELOPE);

  if (relaxed.ok) {
    return {
      tier: 'degraded',
      envelope: DEGRADED_ENVELOPE,
      reason: input.skipStrictAttempt ? 'previous-boot-failed' : 'caveat',
      // The *strict* attempt's message is the interesting one here: it says why
      // this machine was refused a first-class context.
      statusMessage: strict?.statusMessage ?? null,
      probed: true,
    };
  }

  // Nothing to render with. Ask once more with no attributes at all, purely to
  // classify the failure — the same distinction three draws between "Error
  // creating WebGL context with your selected attributes." and "Error creating
  // WebGL context.". It changes what the unsupported screen says, not what
  // happens next: a machine that only grants a context without depth or stencil
  // cannot run this renderer either way.
  const bareCanvas = createCanvas();
  const bare = bareCanvas
    ? attemptContext(bareCanvas, {})
    : ({ ok: false, statusMessage: null } satisfies ProbeAttemptResult);

  return {
    tier: 'unsupported',
    envelope: DEGRADED_ENVELOPE,
    reason: bare.ok ? 'attributes-rejected' : 'no-context',
    statusMessage: relaxed.statusMessage ?? strict?.statusMessage ?? bare.statusMessage ?? null,
    probed: true,
  };
}

export interface BootGraphicsInput extends GraphicsProbeInput {
  /** `isSoftwareRendererAllowed()` — the harness opt-out. */
  captureMode?: boolean;
  /** From the boot-crash guard: the previous start never got a steady frame. */
  previousBootFailed?: boolean;
}

/**
 * The one call `App` makes, before the Canvas exists.
 *
 * Capture mode short-circuits the probe entirely (see `CAPTURE_ENVELOPE`); a
 * failed previous boot skips the optimistic attempt but still has to prove that
 * *some* context is available, because "unsupported" and "slow" need different
 * screens.
 */
export function negotiateBootGraphics(input: BootGraphicsInput = {}): GraphicsCapability {
  if (input.captureMode) {
    sessionCapability = {
      tier: 'hardware',
      envelope: CAPTURE_ENVELOPE,
      reason: 'capture-mode',
      statusMessage: null,
      probed: false,
    };
    return sessionCapability;
  }

  const capability = probeGraphicsCapability({
    createCanvas: input.createCanvas,
    skipStrictAttempt: input.skipStrictAttempt || input.previousBootFailed,
  });

  if (capability.tier === 'unsupported') {
    console.error(
      '[Renderer] No WebGL2 context available — the game will not mount.',
      capability.statusMessage ?? '(no statusMessage from the browser)'
    );
  } else if (capability.tier === 'degraded') {
    console.warn(
      `[Renderer] Safe graphics mode (${capability.reason}) — antialias off, default adapter.`
    );
  }

  sessionCapability = capability;
  return capability;
}

// ---------------------------------------------------------------------------
// Session singleton
// ---------------------------------------------------------------------------

/**
 * The negotiated capability for this page load.
 *
 * A module singleton rather than a prop chain because it is genuinely a
 * property of the session, and because everything that needs it
 * (`RendererQualitySync` inside the Canvas, diagnostics, the badge) sits at a
 * different depth of the tree. `negotiateBootGraphics()` writes it; nothing
 * else may.
 */
let sessionCapability: GraphicsCapability | null = null;

/** Test seam — drop the negotiated capability so the next boot re-negotiates. */
export function resetSessionGraphicsCapability(): void {
  sessionCapability = null;
}

/** What boot negotiated, or null when negotiation has not run (editor, tests). */
export function getSessionGraphicsCapability(): GraphicsCapability | null {
  return sessionCapability;
}

/**
 * The envelope every derive call should use.
 *
 * Falls back to `HARDWARE_ENVELOPE` before negotiation has run: a Canvas that
 * boots outside the game path (the Level Editor pins its own) should get the
 * unsurprising answer rather than a degraded one.
 */
export function getSessionGraphicsEnvelope(): GraphicsEnvelope {
  return sessionCapability?.envelope ?? HARDWARE_ENVELOPE;
}
