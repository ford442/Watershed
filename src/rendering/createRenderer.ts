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
 * - `webgl`:  THREE.WebGLRenderer — production path for legacy GLSL materials.
 * - `webgpu`: Falls back to WebGLRenderer until legacy materials migrate to
 *   NodeMaterial/TSL (WebGPURenderer rejects onBeforeCompile + ShaderMaterial).
 *
 * Legacy materials (RiverShader onBeforeCompile, FlowingWater ShaderMaterial,
 * post-processing GLSL) are incompatible with WebGPURenderer's NodeMaterial
 * pipeline even when `forceWebGL: true`.
 *
 * @invariant This function always returns a THREE.WebGLRenderer today. See
 *   docs/RENDERER_CONTRACT.md before changing the return type or fallback
 *   logic; PRs #252 and #253 established this contract.
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

  // Production path: custom GLSL shaders require the classic WebGLRenderer.
  if (preference === 'webgl') {
    return createWebGLRenderer();
  }

  // WebGPURenderer ships WGSL as data:text/wgsl;base64,... internal modules.
  // Strict CSP (connect-src without data:) blocks those fetches and leaves a
  // blank canvas with shader validation errors in the console.
  const dataUrlsAllowed = await isDataUrlConnectAllowed();
  if (!dataUrlsAllowed) {
    console.warn(
      '[Renderer] CSP blocks data: URLs required by WebGPURenderer — using WebGLRenderer. ' +
        'Add data: to connect-src or use ?renderer=webgl.'
    );
    persistRendererPreference('webgl');
    return createWebGLRenderer();
  }

  // forceWebGL still routes materials through NodeMaterial, which rejects
  // legacy MeshStandardMaterial.onBeforeCompile and ShaderMaterial.
  console.warn(
    '[Renderer] Legacy GLSL materials are incompatible with WebGPURenderer — using WebGLRenderer. ' +
      'Use ?renderer=webgl or wait for NodeMaterial migration.'
  );
  persistRendererPreference('webgl');
  return createWebGLRenderer();
}
