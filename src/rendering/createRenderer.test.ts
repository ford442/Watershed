import * as THREE from 'three';

import { createGameRenderer } from './createRenderer';
import { createRiverMaterial } from '../utils/RiverShader';
import { createCanyonMaterial } from '../materials/CanyonMaterial';
import { createRiverNodeMaterial } from '../materials/RiverNodeMaterial';

jest.mock('./cspProbe', () => ({
  isDataUrlConnectAllowed: jest.fn(),
}));

jest.mock('./rendererConfig', () => ({
  persistRendererPreference: jest.fn(),
}));

import { isDataUrlConnectAllowed } from './cspProbe';

beforeEach(() => {
  // react-scripts sets resetMocks: true, which clears implementations set in
  // jest.mock factories. Re-apply the CSP probe mock before every test.
  (isDataUrlConnectAllowed as jest.Mock).mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// jsdom has no native WebGL context. Provide a minimal fake context so
// THREE.WebGLRenderer can be instantiated and exercised in unit tests.
// This is test scaffolding only; it does not change renderer behavior.
// ---------------------------------------------------------------------------

const WEBGL_CONSTANTS: Record<string, number> = {
  VERSION: 0x1f02,
  VENDOR: 0x1f00,
  RENDERER: 0x1f01,
  SHADING_LANGUAGE_VERSION: 0x8b8c,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
  MAX_VERTEX_ATTRIBS: 0x8869,
  MAX_VERTEX_UNIFORM_VECTORS: 0x8dfb,
  MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
  MAX_VARYING_VECTORS: 0x8dfc,
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_CUBE_MAP_TEXTURE_SIZE: 0x851c,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_VIEWPORT_DIMS: 0x0d3a,
  RED_BITS: 0x0d52,
  GREEN_BITS: 0x0d53,
  BLUE_BITS: 0x0d54,
  ALPHA_BITS: 0x0d55,
  DEPTH_BITS: 0x0d56,
  STENCIL_BITS: 0x0d57,
  SCISSOR_BOX: 0x0c10,
  VIEWPORT: 0x0ba2,
  BLEND: 0x0be2,
  CULL_FACE: 0x0b44,
  DEPTH_TEST: 0x0b71,
  POLYGON_OFFSET_FILL: 0x8037,
  SCISSOR_TEST: 0x0c11,
  STENCIL_TEST: 0x0b90,
  SAMPLE_ALPHA_TO_COVERAGE: 0x809e,
  SAMPLE_COVERAGE: 0x80a0,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_ALIGNMENT: 0x0cf5,
  TEXTURE0: 0x84c0,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  TEXTURE_2D: 0x0de1,
  TEXTURE_CUBE_MAP: 0x8513,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  FLOAT: 0x1406,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  REPEAT: 0x2901,
  MIRRORED_REPEAT: 0x8370,
  FRONT: 0x0404,
  BACK: 0x0405,
  FRONT_AND_BACK: 0x0408,
  CW: 0x0900,
  CCW: 0x0901,
  LESS: 0x0201,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  GEQUAL: 0x0206,
  EQUAL: 0x0202,
  NOTEQUAL: 0x0205,
  ALWAYS: 0x0207,
  NEVER: 0x0200,
  ONE: 0x0001,
  ZERO: 0x0000,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_ALPHA: 0x0304,
  ONE_MINUS_DST_ALPHA: 0x0305,
  SRC_COLOR: 0x0300,
  ONE_MINUS_SRC_COLOR: 0x0301,
  DST_COLOR: 0x0306,
  ONE_MINUS_DST_COLOR: 0x0307,
  FUNC_ADD: 0x8006,
  FUNC_SUBTRACT: 0x800a,
  FUNC_REVERSE_SUBTRACT: 0x800b,
  MIN: 0x8007,
  MAX: 0x8008,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  COLOR_ATTACHMENT0: 0x8ce0,
  DEPTH_ATTACHMENT: 0x8d00,
  STENCIL_ATTACHMENT: 0x8d20,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  RENDERBUFFER: 0x8d41,
  DEPTH_COMPONENT16: 0x81a5,
  STENCIL_INDEX8: 0x8d48,
  DEPTH_STENCIL: 0x84f9,
  RGBA4: 0x8056,
  RGB5_A1: 0x8057,
  RGB565: 0x8d62,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  FLOAT_VEC2: 0x8b50,
  FLOAT_VEC3: 0x8b51,
  FLOAT_VEC4: 0x8b52,
  INT_VEC2: 0x8b53,
  INT_VEC3: 0x8b54,
  INT_VEC4: 0x8b55,
  BOOL: 0x8b56,
  BOOL_VEC2: 0x8b57,
  BOOL_VEC3: 0x8b58,
  BOOL_VEC4: 0x8b59,
  FLOAT_MAT2: 0x8b5a,
  FLOAT_MAT3: 0x8b5b,
  FLOAT_MAT4: 0x8b5c,
  SAMPLER_2D: 0x8b5e,
  SAMPLER_CUBE: 0x8b60,
  COMPRESSED_TEXTURE_S3TC: 0x83f0,
  COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f1,
  COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f2,
  COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f3,
  COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f4,
  TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
  HALF_FLOAT: 0x140b,
  HALF_FLOAT_OES: 0x8d61,
};

function createMockWebGLContext(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const handlers: Record<string, unknown> = {
    canvas,
    drawingBufferWidth: canvas.width,
    drawingBufferHeight: canvas.height,
    getExtension: jest.fn(() => null),
    getSupportedExtensions: jest.fn(() => []),
    getParameter: jest.fn((p: number) => {
      if (p === WEBGL_CONSTANTS.VERSION) return 'WebGL 1.0 (Mock)';
      if (p === WEBGL_CONSTANTS.VENDOR) return 'Mock Vendor';
      if (p === WEBGL_CONSTANTS.RENDERER) return 'Mock Renderer';
      if (p === WEBGL_CONSTANTS.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 1.0 (Mock)';
      if (p === WEBGL_CONSTANTS.MAX_COMBINED_TEXTURE_IMAGE_UNITS) return 8;
      if (p === WEBGL_CONSTANTS.MAX_TEXTURE_IMAGE_UNITS) return 8;
      if (p === WEBGL_CONSTANTS.MAX_VERTEX_TEXTURE_IMAGE_UNITS) return 4;
      if (p === WEBGL_CONSTANTS.MAX_VERTEX_ATTRIBS) return 16;
      if (p === WEBGL_CONSTANTS.MAX_VERTEX_UNIFORM_VECTORS) return 256;
      if (p === WEBGL_CONSTANTS.MAX_FRAGMENT_UNIFORM_VECTORS) return 256;
      if (p === WEBGL_CONSTANTS.MAX_VARYING_VECTORS) return 16;
      if (p === WEBGL_CONSTANTS.MAX_TEXTURE_SIZE) return 4096;
      if (p === WEBGL_CONSTANTS.MAX_CUBE_MAP_TEXTURE_SIZE) return 4096;
      if (p === WEBGL_CONSTANTS.MAX_RENDERBUFFER_SIZE) return 4096;
      if (p === WEBGL_CONSTANTS.MAX_VIEWPORT_DIMS) return new Int32Array([4096, 4096]);
      if (p === WEBGL_CONSTANTS.SCISSOR_BOX) return new Int32Array([0, 0, canvas.width, canvas.height]);
      if (p === WEBGL_CONSTANTS.VIEWPORT) return new Int32Array([0, 0, canvas.width, canvas.height]);
      if (p === WEBGL_CONSTANTS.RED_BITS || p === WEBGL_CONSTANTS.GREEN_BITS || p === WEBGL_CONSTANTS.BLUE_BITS || p === WEBGL_CONSTANTS.ALPHA_BITS) return 8;
      if (p === WEBGL_CONSTANTS.DEPTH_BITS) return 24;
      if (p === WEBGL_CONSTANTS.STENCIL_BITS) return 8;
      return 0;
    }),
    getShaderPrecisionFormat: jest.fn(() => ({ precision: 23, rangeMin: 127, rangeMax: 127 })),
    createShader: jest.fn(() => ({})),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    getShaderParameter: jest.fn(() => true),
    getShaderInfoLog: jest.fn(() => ''),
    deleteShader: jest.fn(),
    createProgram: jest.fn(() => ({})),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    getProgramParameter: jest.fn(() => true),
    getProgramInfoLog: jest.fn(() => ''),
    deleteProgram: jest.fn(),
    useProgram: jest.fn(),
    createBuffer: jest.fn(() => ({})),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    deleteBuffer: jest.fn(),
    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    disableVertexAttribArray: jest.fn(),
    createTexture: jest.fn(() => ({})),
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    texParameteri: jest.fn(),
    texParameterf: jest.fn(),
    activeTexture: jest.fn(),
    deleteTexture: jest.fn(),
    createFramebuffer: jest.fn(() => ({})),
    bindFramebuffer: jest.fn(),
    framebufferTexture2D: jest.fn(),
    checkFramebufferStatus: jest.fn(() => WEBGL_CONSTANTS.FRAMEBUFFER_COMPLETE),
    deleteFramebuffer: jest.fn(),
    createRenderbuffer: jest.fn(() => ({})),
    bindRenderbuffer: jest.fn(),
    renderbufferStorage: jest.fn(),
    framebufferRenderbuffer: jest.fn(),
    deleteRenderbuffer: jest.fn(),
    viewport: jest.fn(),
    scissor: jest.fn(),
    clearColor: jest.fn(),
    clear: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    blendFunc: jest.fn(),
    blendFuncSeparate: jest.fn(),
    depthFunc: jest.fn(),
    depthMask: jest.fn(),
    cullFace: jest.fn(),
    frontFace: jest.fn(),
    polygonOffset: jest.fn(),
    lineWidth: jest.fn(),
    pixelStorei: jest.fn(),
    getError: jest.fn(() => 0),
    readPixels: jest.fn(),
    drawArrays: jest.fn(),
    drawElements: jest.fn(),
    uniform1f: jest.fn(),
    uniform1i: jest.fn(),
    uniform2f: jest.fn(),
    uniform3f: jest.fn(),
    uniform4f: jest.fn(),
    uniformMatrix4fv: jest.fn(),
    uniform1fv: jest.fn(),
    uniform2fv: jest.fn(),
    uniform3fv: jest.fn(),
    uniform4fv: jest.fn(),
    getAttribLocation: jest.fn(() => 0),
    getUniformLocation: jest.fn(() => ({})),
  };

  return new Proxy({} as WebGLRenderingContext, {
    get(target, prop) {
      const key = String(prop);
      if (key in handlers) return handlers[key];
      if (key in WEBGL_CONSTANTS) return WEBGL_CONSTANTS[key];
      if (key.toUpperCase() === key) return 0;
      return jest.fn();
    },
  });
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    options?: unknown
  ) {
    if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
      return createMockWebGLContext(this) as unknown as RenderingContext;
    }
    return originalGetContext.call(this, type, options);
  };
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createGameRenderer', () => {
  const canvasProps = { canvas: document.createElement('canvas') };

  it('returns WebGLRenderer when preference is webgl', async () => {
    const renderer = await createGameRenderer(canvasProps, { preference: 'webgl' });
    expect(renderer.isWebGLRenderer).toBe(true);
    expect(renderer.isWebGPURenderer).toBeFalsy();
    renderer.dispose();
  });

  it('falls back to WebGLRenderer when preference is webgpu (legacy materials)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renderer = await createGameRenderer(canvasProps, { preference: 'webgpu' });
    expect(renderer.isWebGLRenderer).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Legacy GLSL materials are incompatible with WebGPURenderer')
    );
    warnSpy.mockRestore();
    renderer.dispose();
  });
});

describe('createGameRenderer legacy material pipeline guard', () => {
  /**
   * Regression guard for PRs #252 and #253.
   *
   * The production pipeline uses legacy GLSL materials (RiverShader's
   * MeshStandardMaterial.onBeforeCompile, CanyonMaterial's ShaderMaterial, and
   * GLSL post-processing). These materials crash when routed through a
   * WebGPURenderer / NodeMaterial pipeline ("c is not a constructor" in
   * setupLightsNode, "Cannot read properties of undefined (reading 'replace')"
   * during shader compile).
   *
   * This test locks the current contract: createGameRenderer MUST return a
   * THREE.WebGLRenderer for both 'webgl' and 'webgpu' preferences, and the
   * production materials MUST be preparable against that renderer without
   * throwing a NodeMaterial-incompatibility error.
   */

  function createSceneWithMaterials(materials: THREE.Material[]) {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (const material of materials) {
      scene.add(new THREE.Mesh(geometry, material));
    }
    return scene;
  }

  function buildProductionMaterials() {
    const riverMaterial = createRiverMaterial();
    const canyonMaterial = createCanyonMaterial();
    const riverNodeMaterial = createRiverNodeMaterial();

    expect(riverMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(canyonMaterial).toBeInstanceOf(THREE.ShaderMaterial);
    expect(riverNodeMaterial.type).toBe('MeshStandardNodeMaterial');

    // Trigger RiverShader's onBeforeCompile manually; this is where the GLSL
    // injection happens. It must complete without throwing.
    const mockShader = {
      uniforms: {},
      vertexShader: '#include <begin_vertex>\nvoid main() {}',
      fragmentShader:
        '#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\nvoid main() {}',
    };
    expect(() => riverMaterial.onBeforeCompile?.(mockShader as any)).not.toThrow();

    return { riverMaterial, canyonMaterial, riverNodeMaterial };
  }

  describe.each(['webgl', 'webgpu'] as const)('preference: %s', (preference) => {
    it('returns a THREE.WebGLRenderer (not WebGPURenderer)', async () => {
      const renderer = await createGameRenderer(
        { canvas: document.createElement('canvas') },
        { preference }
      );

      expect(renderer.isWebGLRenderer).toBe(true);
      expect((renderer as any).isWebGPURenderer).toBeFalsy();

      renderer.dispose();
    });

    it('compiles legacy GLSL materials without NodeMaterial-incompatibility error', async () => {
      const renderer = await createGameRenderer(
        { canvas: document.createElement('canvas') },
        { preference }
      );

      const materials = buildProductionMaterials();
      const legacyScene = createSceneWithMaterials([
        materials.riverMaterial,
        materials.canyonMaterial,
      ]);
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

      // Legacy GLSL materials are the production path guarded by PRs #252/#253.
      // This fails loudly if createGameRenderer is reverted to return a
      // WebGPURenderer while onBeforeCompile / ShaderMaterial are still in use.
      expect(() => renderer.compile(legacyScene, camera)).not.toThrow();

      renderer.dispose();
    });
  });
});
