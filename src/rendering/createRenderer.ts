import * as THREE from 'three';
import type { RendererPreference } from './types';
import { isDataUrlConnectAllowed } from './cspProbe';
import { persistRendererPreference } from './rendererConfig';
import { applyRendererContextOptions } from './applyRendererContextOptions';
import {
  toContextAttributes,
  type RendererContextOptions,
} from './deriveRendererContextOptions';
import type { MaterialBackend } from './materialBackend';
import { updateRendererDiagnostics } from './rendererState';
import { loadNodeMaterials } from '../materials/nodeMaterials';
import { loadNodePost } from '../components/postProcessing/nodePostLoader';
import { bridgeCoreNodeClasses, type NodeClassExports } from './nodeLibraryBridge';
import { extractRendererGpuDevice, registerSessionGpuDevice } from './gpuChores/device';
import { mustForceWebGLForNodeRenderer } from './nativeWebgpuGate';
import { GL_CONTEXT_NAME, webGLContextAttributesFor } from './contextAttributes';

export interface GameRendererOptions {
  preference: RendererPreference;
  antialias?: boolean;
  powerPreference?: WebGLPowerPreference;
  /** Quality-derived tone mapping, color space, and shadow configuration. */
  contextOptions?: RendererContextOptions;
  /**
   * Material implementation the scene will build (#256 path A). `tsl` requires a
   * node-capable renderer; `glsl` (default) keeps the classic WebGLRenderer.
   */
  materialBackend?: MaterialBackend;
}

/**
 * What the Canvas gets. `THREE.WebGLRenderer` on the default path; the node
 * renderer (WebGPURenderer, WebGL2 backend unless WebGPU is also requested)
 * when TSL materials are active.
 */
export type GameRenderer = THREE.WebGLRenderer;

/**
 * Creates the Three.js renderer for the game Canvas.
 *
 * @invariant On the DEFAULT path (`materialBackend: 'glsl'`) this function always
 *   returns a THREE.WebGLRenderer, and the `webgpu` preference stays a no-op
 *   fallback to WebGL2. Legacy GLSL materials (RiverShader onBeforeCompile,
 *   FlowingWater ShaderMaterial, GLSL post-processing) are incompatible with
 *   WebGPURenderer's NodeMaterial pipeline and crashed production twice
 *   (PRs #252 and #253). That rule is unchanged.
 *
 *   `materialBackend: 'tsl'` (#256 path A, opt-in via `?material=tsl`) is the one
 *   exception: TSL materials need a node pipeline, so a WebGPURenderer is created
 *   with `forceWebGL: true` — WebGL2 on the wire, node materials above it. A real
 *   WebGPU backend (`forceWebGL: false`) is gated on an empty residual GLSL
 *   allowlist plus a ported (or skipped) post stack — see nativeWebgpuGate.ts.
 *
 *   Either node path honors the boot graphics contract: on WebGL2 the context is
 *   created here from the attribute object the probe tested and passed in as
 *   `context`; native WebGPU gets explicit parameters
 *   (`nativeWebGPURendererParameters`) rather than WebGL attributes.
 *
 *   See docs/reference/RENDERER_CONTRACT.md before changing the return type or fallback
 *   logic.
 */
export async function createGameRenderer(
  canvasProps: THREE.WebGLRendererParameters,
  options: GameRendererOptions
): Promise<GameRenderer> {
  const {
    preference,
    antialias = true,
    powerPreference = 'high-performance',
    contextOptions,
    materialBackend = 'glsl',
  } = options;

  // Quality-derived context attributes (alpha/depth/stencil/caveat/…) when the
  // caller passed a contract; otherwise just the two legacy knobs. These are
  // creation-time only — see `applyRendererQualityUpdate` for what changes live.
  const contextAttributes = contextOptions
    ? toContextAttributes(contextOptions)
    : { antialias, powerPreference };

  const webglParameters: THREE.WebGLRendererParameters = {
    ...canvasProps,
    ...contextAttributes,
  };

  // `context`: a WebGL2 context already created on this canvas with exactly
  // these parameters (the TSL path below). Reused rather than asking again.
  const createWebGLRenderer = (context?: WebGL2RenderingContext) => {
    const renderer = new THREE.WebGLRenderer(
      context ? { ...webglParameters, context } : webglParameters
    );
    // Handed a context, THREE takes `alpha` from it (always true) instead of
    // our `alpha: false`, and WebGLBackground would clear transparent. Pin the
    // opaque clear our parameters asked for.
    if (context) renderer.setClearAlpha(1);
    if (contextOptions) {
      applyRendererContextOptions(renderer, contextOptions);
    }
    registerSessionGpuDevice(null);
    return renderer;
  };

  // TSL materials cannot run on THREE.WebGLRenderer — they need WebGPURenderer.
  // Native WebGPU opens only behind canEnableNativeWebgpu() (nativeWebgpuGate.ts).
  if (materialBackend === 'tsl') {
    const forceWebGL = mustForceWebGLForNodeRenderer() || preference !== 'webgpu';
    const fallBackToGlsl = (context?: WebGL2RenderingContext) => {
      console.warn(
        '[Renderer] Node-capable renderer unavailable — falling back to WebGLRenderer with GLSL materials.'
      );
      updateRendererDiagnostics({ materialBackend: 'glsl' });
      return createWebGLRenderer(context);
    };

    if (!forceWebGL) {
      const nativeRenderer = await createNodeRenderer({
        parameters: nativeWebGPURendererParameters(canvasProps, contextAttributes),
        contextOptions,
        clearOpaque: true,
      });
      return nativeRenderer ?? fallBackToGlsl();
    }

    // The node WebGL2 backend would build its own attribute object (antialias
    // from its internal sample count; no power preference, caveat flag, or
    // preserveDrawingBuffer). Create the context the boot probe proved instead —
    // the same object THREE.WebGLRenderer would request — and hand it over.
    // R3F hands us its DOM canvas; three's OffscreenCanvas typing is a stub.
    const canvas = (canvasProps.canvas as HTMLCanvasElement | undefined) ?? createCanvasElement();
    webglParameters.canvas = canvas;
    const context = canvas.getContext(
      GL_CONTEXT_NAME,
      webGLContextAttributesFor(webglParameters)
    ) as WebGL2RenderingContext | null;
    // No context: nothing was created on this canvas, so the classic renderer's
    // own request (same attributes) is the first real one — and its throw is the
    // one bootCrashGuard records.
    if (!context) return fallBackToGlsl();

    const nodeRenderer = await createNodeRenderer({
      parameters: { ...webglParameters, context, forceWebGL: true, trackTimestamp: true },
      contextOptions,
      clearOpaque: false,
    });
    return nodeRenderer ?? fallBackToGlsl(context);
  }

  // Live renderer: custom GLSL shaders require the classic WebGLRenderer.
  if (preference === 'webgl') {
    return createWebGLRenderer();
  }

  // `preference === 'webgpu'` is currently a deliberate no-op fallback.
  // WebGPURenderer is NOT instantiated because legacy GLSL materials crash
  // inside its NodeMaterial pipeline. Issue #256 path A will replace the
  // legacy materials with NodeMaterial/TSL before re-enabling WebGPURenderer.
  const dataUrlsAllowed = await isDataUrlConnectAllowed();
  if (!dataUrlsAllowed) {
    console.warn(
      '[Renderer] WebGPU preference is experimental/no-op and CSP blocks data: URLs — using WebGLRenderer. ' +
        'Force the safe path with ?renderer=webgl.'
    );
    persistRendererPreference('webgl');
    return createWebGLRenderer();
  }

  console.warn(
    '[Renderer] WebGPU preference is experimental/no-op — Legacy GLSL materials are incompatible ' +
      'with WebGPURenderer, so the game falls back to WebGLRenderer. See docs/reference/RENDERER_CONTRACT.md.'
  );
  persistRendererPreference('webgl');
  return createWebGLRenderer();
}

/** Constructor surface of `three/webgpu`'s WebGPURenderer that we depend on. */
export interface NodeRendererParameters extends Omit<THREE.WebGLRendererParameters, 'context'> {
  /** WebGL2 backend only: use this context instead of calling `getContext`. */
  context?: WebGL2RenderingContext;
  /** True keeps the WebGL2 backend; false lets the renderer negotiate WebGPU. */
  forceWebGL?: boolean;
  trackTimestamp?: boolean;
}

/** What the native WebGPU path passes — and nothing else. */
export interface NativeWebGPURendererParameters {
  canvas?: THREE.WebGLRendererParameters['canvas'];
  /** WebGPUBackend maps this straight to the canvas `alphaMode`. */
  alpha: true;
  /** Renderer MSAA (`samples`) on its own frame-buffer target — not a canvas flag. */
  antialias: boolean;
  /** No pass in the node post pipeline uses stencil. */
  stencil: false;
  /** Forwarded by three to `requestAdapter` only. Absent means the UA default. */
  powerPreference?: GPUPowerPreference;
  forceWebGL: false;
  /**
   * GPU frame time for the render-scale valve (#466 Phase B). Native WebGPU
   * uses `timestamp-query`, which three requests when the adapter has it.
   */
  trackTimestamp: true;
}

/**
 * Explicit native WebGPU configuration, instead of spreading WebGL context
 * attributes into WebGPURenderer and hoping they mean something there.
 *
 * - `alpha: true` → `alphaMode: 'premultiplied'`, the convention every
 *   transparent material is authored against (`SHARED_CONTEXT_ATTRIBUTES.
 *   premultipliedAlpha`). `alpha: false` would configure `'opaque'`. The opaque
 *   look comes from the clear alpha instead (`setClearAlpha(1)` after init).
 * - `powerPreference` from the envelope; WebGPU has no `'default'`, so that maps
 *   to "unspecified".
 * - No `failIfMajorPerformanceCaveat`: not a WebGPU concept. A missing adapter
 *   already falls back inside three.
 * - No `device`: WebGPURenderer is the session's only `requestDevice()` caller;
 *   gpu-chores adopt `backend.device` (gpuChores/device.ts).
 */
export function nativeWebGPURendererParameters(
  canvasProps: Pick<THREE.WebGLRendererParameters, 'canvas'>,
  creation: { antialias?: boolean; powerPreference?: WebGLPowerPreference }
): NativeWebGPURendererParameters {
  const powerPreference =
    creation.powerPreference && creation.powerPreference !== 'default'
      ? creation.powerPreference
      : undefined;
  return {
    ...(canvasProps.canvas ? { canvas: canvasProps.canvas } : {}),
    alpha: true,
    antialias: creation.antialias ?? false,
    stencil: false,
    ...(powerPreference ? { powerPreference } : {}),
    forceWebGL: false,
    trackTimestamp: true,
  };
}

function createCanvasElement(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  return canvas;
}

interface NodeRendererModule extends NodeClassExports {
  WebGPURenderer: new (
    parameters?: NodeRendererParameters | NativeWebGPURendererParameters
  ) => THREE.WebGLRenderer & {
    init(): Promise<void>;
  };
}

interface NodeRendererRequest {
  parameters: NodeRendererParameters | NativeWebGPURendererParameters;
  contextOptions?: RendererContextOptions;
  /**
   * Native path: `alpha: true` makes the renderer's default clear alpha 0, which
   * on a premultiplied canvas lets the page show through. Clear opaque instead,
   * as WebGLBackground does on the WebGL paths.
   */
  clearOpaque: boolean;
}

/**
 * Build the node-capable renderer, or null when it cannot be created.
 *
 * `three/webgpu` is imported lazily so the default GLSL path never pays for the
 * WebGPU bundle, and every failure mode (missing module, no adapter, init
 * rejection) resolves to null rather than throwing into the Canvas.
 */
async function createNodeRenderer(
  request: NodeRendererRequest
): Promise<GameRenderer | null> {
  try {
    // Load the node renderer, every TSL material module and the node post
    // pipeline together: the Canvas `gl` callback awaits this, so materials and
    // post built later in the scene can stay synchronous and find them resolved.
    const [nodeModule] = await Promise.all([
      import('three/webgpu') as unknown as Promise<NodeRendererModule>,
      loadNodeMaterials(),
      loadNodePost(),
    ]);
    const { WebGPURenderer } = nodeModule;
    // `parameters` already carries the boot graphics contract (#463) and
    // `trackTimestamp` for the render-scale valve (#466 Phase B).
    const renderer = new WebGPURenderer(request.parameters);
    await renderer.init();
    if (request.clearOpaque) renderer.setClearAlpha(1);

    // Guard for the node library's class-identity lookups. At r178 `three` and
    // `three/webgpu` share one core and this bridges nothing; it re-registers
    // what a later bump might split apart again. See nodeLibraryBridge.ts.
    bridgeCoreNodeClasses(renderer, nodeModule);

    if (request.contextOptions) {
      applyRendererContextOptions(renderer, request.contextOptions);
    }
    updateRendererDiagnostics({ materialBackend: 'tsl' });
    const device = extractRendererGpuDevice(renderer);
    registerSessionGpuDevice(device);
    return renderer;
  } catch (error) {
    console.warn('[Renderer] WebGPURenderer initialization failed', error);
    return null;
  }
}
