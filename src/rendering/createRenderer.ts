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
import { extractRendererGpuDevice, registerSessionGpuDevice } from './gpuChores/device';

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
 *   WebGPU backend still requires `?renderer=webgpu` on top, and is only sound once
 *   every live material is TSL.
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

  const createWebGLRenderer = () => {
    const renderer = new THREE.WebGLRenderer({
      ...canvasProps,
      ...contextAttributes,
    });
    if (contextOptions) {
      applyRendererContextOptions(renderer, contextOptions);
    }
    registerSessionGpuDevice(null);
    return renderer;
  };

  // TSL materials cannot run on THREE.WebGLRenderer — it has no node pipeline.
  // They need WebGPURenderer, which we create with a WebGL2 backend unless the
  // WebGPU preference is ALSO set. That is the point of path A: change the
  // material pipeline first, the graphics API second.
  if (materialBackend === 'tsl') {
    const nodeRenderer = await createNodeRenderer({
      canvasProps,
      antialias,
      powerPreference,
      contextOptions,
      forceWebGL: preference !== 'webgpu',
    });
    if (nodeRenderer) return nodeRenderer;

    console.warn(
      '[Renderer] Node-capable renderer unavailable — falling back to WebGLRenderer with GLSL materials.'
    );
    updateRendererDiagnostics({ materialBackend: 'glsl' });
    return createWebGLRenderer();
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
interface NodeRendererParameters extends THREE.WebGLRendererParameters {
  forceWebGL?: boolean;
}

interface NodeRendererModule {
  WebGPURenderer: new (parameters?: NodeRendererParameters) => THREE.WebGLRenderer & {
    init(): Promise<void>;
  };
}

interface NodeRendererRequest {
  canvasProps: THREE.WebGLRendererParameters;
  antialias: boolean;
  powerPreference: WebGLPowerPreference;
  contextOptions?: RendererContextOptions;
  /** True keeps the WebGL2 backend; false lets the renderer negotiate WebGPU. */
  forceWebGL: boolean;
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
    // Load the node renderer and every TSL material module together: the Canvas
    // `gl` callback awaits this, so materials built later in the scene can stay
    // synchronous and still find the module resolved.
    const [{ WebGPURenderer }] = await Promise.all([
      import('three/webgpu') as unknown as Promise<NodeRendererModule>,
      loadNodeMaterials(),
    ]);
    const renderer = new WebGPURenderer({
      ...request.canvasProps,
      ...(request.contextOptions
        ? toContextAttributes(request.contextOptions)
        : { antialias: request.antialias, powerPreference: request.powerPreference }),
      forceWebGL: request.forceWebGL,
    });
    await renderer.init();

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
