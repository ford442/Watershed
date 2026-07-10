import * as THREE from 'three';
import type { RendererPreference } from './types';
import { isDataUrlConnectAllowed } from './cspProbe';
import { persistRendererPreference } from './rendererConfig';

export interface GameRendererOptions {
  preference: RendererPreference;
  antialias?: boolean;
  powerPreference?: WebGLPowerPreference;
}

/**
 * Creates the Three.js renderer for the game Canvas.
 *
 * @invariant This function ALWAYS returns a THREE.WebGLRenderer today.
 *   The `webgpu` preference is intentionally a no-op fallback to WebGL2.
 *   There is no live WebGPURenderer path; legacy GLSL materials
 *   (RiverShader onBeforeCompile, FlowingWater ShaderMaterial, GLSL
 *   post-processing) are incompatible with WebGPURenderer's NodeMaterial
 *   pipeline and crashed production twice (PRs #252 and #253).
 *
 *   See docs/RENDERER_CONTRACT.md before changing the return type or fallback
 *   logic; issue #256 path A owns the real WebGPU/TSL migration.
 */
export async function createGameRenderer(
  canvasProps: THREE.WebGLRendererParameters,
  options: GameRendererOptions
): Promise<THREE.WebGLRenderer> {
  const {
    preference,
    antialias = true,
    powerPreference = 'high-performance',
  } = options;

  const createWebGLRenderer = () =>
    new THREE.WebGLRenderer({
      ...canvasProps,
      antialias,
      powerPreference,
    });

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
      'with WebGPURenderer, so the game falls back to WebGLRenderer. See docs/RENDERER_CONTRACT.md.'
  );
  persistRendererPreference('webgl');
  return createWebGLRenderer();
}
