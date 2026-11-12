/**
 * parityFrame — the renderer pair and readback the GLSL vs TSL parity harnesses
 * share (`postParity.ts`, `hostParity.ts`; #466 Phase A, #555 Phase A).
 *
 * Both renderers are built the way `createGameRenderer` builds them for a run:
 *   - GLSL: `THREE.WebGLRenderer` over three's HalfFloat output buffer, so every
 *     material draws linear HDR and three applies the grade once at the end;
 *   - TSL:  `WebGPURenderer({ forceWebGL: true })` (WebGL2 on the wire), which
 *     applies the same grade at its output.
 * Frames are read back in the same task as the render, so neither canvas needs a
 * preserved drawing buffer for the read to see the frame.
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { DEFAULT_TONE_MAPPING_EXPOSURE } from '../rendering/deriveRendererContextOptions';

export const PARITY_WIDTH = 320;
export const PARITY_HEIGHT = 180;

export interface FrameStats {
  /** Mean Rec.709 luma, 0..1. */
  luma: number;
  /** Mean |Δluma| between horizontal neighbours, 0..1 — aliasing raises it. */
  edge: number;
}

/** The renderer grade every preset uses (`deriveRendererContextOptions`). */
export function applyGrade(renderer: { toneMapping: THREE.ToneMapping; toneMappingExposure: number; outputColorSpace: string }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DEFAULT_TONE_MAPPING_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  return canvas;
}

export function createGlslParityRenderer(width = PARITY_WIDTH, height = PARITY_HEIGHT): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas: makeCanvas(width, height),
    antialias: false,
    preserveDrawingBuffer: true,
    // As createGameRenderer builds it: the post chain is `setEffects` over three's HDR output.
    outputBufferType: THREE.HalfFloatType,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  applyGrade(renderer);
  return renderer;
}

export async function createNodeParityRenderer(width = PARITY_WIDTH, height = PARITY_HEIGHT): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({ canvas: makeCanvas(width, height), antialias: false, forceWebGL: true });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  applyGrade(renderer);
  return renderer;
}

/** One 2D canvas the presented frames are copied into for stats and PNG encoding. */
export class FrameReadback {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly width = PARITY_WIDTH,
    readonly height = PARITY_HEIGHT,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /** Copy what `source` presents. Call in the same task as its render. */
  capture(source: HTMLCanvasElement): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(source, 0, 0, this.width, this.height);
  }

  /** Stats of the last capture. */
  stats(): FrameStats {
    const { data } = this.ctx.getImageData(0, 0, this.width, this.height);
    let sum = 0;
    let edge = 0;
    let prev = 0;
    for (let i = 0, px = 0; i < data.length; i += 4, px += 1) {
      const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += y;
      if (px % this.width !== 0) edge += Math.abs(y - prev);
      prev = y;
    }
    const n = data.length / 4;
    return { luma: sum / n / 255, edge: edge / n / 255 };
  }

  /** The last capture as a PNG data URL. */
  png(): string {
    return this.canvas.toDataURL('image/png');
  }
}

/**
 * Let asynchronous decodes land (SMAA's lookup images, DataTexture uploads)
 * between a first render and the measured one.
 */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 250));
