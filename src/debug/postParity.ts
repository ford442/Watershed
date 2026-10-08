/**
 * postParity — one deterministic frame through both post drivers (#466 Phase A).
 *
 * The game can't serve as a headless reference frame (SwiftShader starves it and
 * the run never advances), so this builds a fixed lit scene and renders it with:
 *   - the GLSL `EffectComposer` driver on `THREE.WebGLRenderer`, and
 *   - the node `RenderPipeline` on `WebGPURenderer({ forceWebGL: true })`,
 * with the same frozen `PostFrameParams`, then compares Rec.709 mean luma of the
 * presented (tone-mapped, sRGB-encoded) pixels. Driven by
 * `verification/post_parity.mjs` through `verification/post_parity.html`.
 *
 * SSAO and god rays stay off: GTAO and SSAOPass are different algorithms, and
 * the point here is the grade (one tone-map + one sRGB encode at the end).
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createComposerDriver } from '../components/PostProcessingPipeline';
import { createNodePostPipeline } from '../components/postProcessing/nodePostPipeline';
import {
  DEFAULT_POST_TUNING,
  linearVignetteDarkness,
  type PostFrameParams,
} from '../components/postProcessing/postFrameParams';
import { DEFAULT_TONE_MAPPING_EXPOSURE } from '../rendering/deriveRendererContextOptions';

export const PARITY_WIDTH = 320;
export const PARITY_HEIGHT = 180;

export interface ParityScenario {
  name: string;
  aa?: 'none' | 'smaa';
  bloom: boolean;
  chromatic: boolean;
  vignette: boolean;
  saturation: number;
}

export const PARITY_SCENARIOS: ParityScenario[] = [
  { name: 'grade', bloom: false, chromatic: false, vignette: true, saturation: 0 },
  { name: 'grade+desaturate', bloom: false, chromatic: true, vignette: true, saturation: -0.3 },
  { name: 'bloom', bloom: true, chromatic: false, vignette: true, saturation: 0 },
  // SMAA moves the node path's output transform inside the graph (#466 Phase C):
  // the grade must not change with it.
  { name: 'grade+smaa', aa: 'smaa', bloom: true, chromatic: false, vignette: true, saturation: 0 },
];

export interface ParityResult {
  scenario: string;
  glslLuma: number;
  /** The GLSL chain with its OutputPass switched off — the pre-#466 image. */
  glslLinearLuma: number;
  nodeLuma: number;
  /** |glsl − node| / max(node, ε). */
  relativeDelta: number;
  /** Mean |Δluma| between horizontal neighbours, per driver — edge AA lowers it. */
  glslEdge: number;
  nodeEdge: number;
}

function buildScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6f93b8);

  const camera = new THREE.PerspectiveCamera(55, PARITY_WIDTH / PARITY_HEIGHT, 0.1, 200);
  camera.position.set(0, 2.2, 6.5);
  camera.lookAt(0, 0.6, 0);
  camera.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight(0xd8e8ff, 0x3a3020, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(4, 8, 5);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const rock = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x9a7b5c, roughness: 0.8 }),
  );
  rock.position.set(-1.4, 0.8, 0);
  rock.rotation.y = 0.5;
  scene.add(rock);

  // Bright emissive: the bloom scenario's source, and HDR (> 1) input for the tone map.
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 3 }),
  );
  glow.position.set(1.5, 1.0, 0.2);
  scene.add(glow);

  return { scene, camera };
}

function paramsFor(s: ParityScenario): PostFrameParams {
  return {
    bloom: { enabled: s.bloom, strength: 0.6, threshold: 0.85, radius: 0.4 },
    ssao: { enabled: false },
    hueSaturation: { saturation: s.saturation },
    chromatic: { enabled: s.chromatic, amount: DEFAULT_POST_TUNING.chromaticBaseOffset },
    vignette: {
      enabled: s.vignette,
      offset: DEFAULT_POST_TUNING.vignetteOffset,
      darkness: linearVignetteDarkness(DEFAULT_POST_TUNING.vignetteDarkness),
    },
    godRays: {
      allowed: false,
      enabled: false,
      sunScreenPosition: new THREE.Vector2(0.5, 0.2),
      sunColor: new THREE.Color('#fff4e0'),
      intensity: 0,
      samples: 16,
      decay: 0.95,
      exposure: 0.18,
      rayLength: 0.4,
      density: 0.96,
      wallOcclusion: 0.92,
      time: 0,
    },
    rainbow: { intensity: 0, time: 0, aspectRatio: PARITY_WIDTH / PARITY_HEIGHT },
    aa: s.aa ?? 'none',
  };
}

/** The renderer grade every preset uses (`deriveRendererContextOptions`). */
function applyGrade(renderer: { toneMapping: THREE.ToneMapping; toneMappingExposure: number; outputColorSpace: string }) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DEFAULT_TONE_MAPPING_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

const readback = document.createElement('canvas');
readback.width = PARITY_WIDTH;
readback.height = PARITY_HEIGHT;
const readbackCtx = readback.getContext('2d', { willReadFrequently: true })!;

interface FrameStats {
  /** Mean Rec.709 luma, 0..1. */
  luma: number;
  /** Mean |Δluma| between horizontal neighbours, 0..1 — aliasing raises it. */
  edge: number;
}

/**
 * Stats of what the canvas presents, read in the same task as the render so
 * the drawing buffer is still intact.
 */
function frameStats(canvas: HTMLCanvasElement): FrameStats {
  readbackCtx.clearRect(0, 0, PARITY_WIDTH, PARITY_HEIGHT);
  readbackCtx.drawImage(canvas, 0, 0, PARITY_WIDTH, PARITY_HEIGHT);
  const { data } = readbackCtx.getImageData(0, 0, PARITY_WIDTH, PARITY_HEIGHT);
  let sum = 0;
  let edge = 0;
  let prev = 0;
  for (let i = 0, px = 0; i < data.length; i += 4, px += 1) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += y;
    if (px % PARITY_WIDTH !== 0) edge += Math.abs(y - prev);
    prev = y;
  }
  const n = data.length / 4;
  return { luma: sum / n / 255, edge: edge / n / 255 };
}

/**
 * SMAA (both implementations) decodes its area/search lookup textures from
 * data-URI images asynchronously; until they land it blends with zero weights.
 * Render once, let decodes finish, then measure.
 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 250));

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PARITY_WIDTH;
  canvas.height = PARITY_HEIGHT;
  document.body.appendChild(canvas);
  return canvas;
}

export async function runPostParity(): Promise<ParityResult[]> {
  const { scene, camera } = buildScene();

  const glsl = new THREE.WebGLRenderer({ canvas: makeCanvas(), antialias: false, preserveDrawingBuffer: true });
  glsl.setPixelRatio(1);
  glsl.setSize(PARITY_WIDTH, PARITY_HEIGHT, false);
  applyGrade(glsl);

  const node = new WebGPURenderer({ canvas: makeCanvas(), antialias: false, forceWebGL: true });
  await node.init();
  node.setPixelRatio(1);
  node.setSize(PARITY_WIDTH, PARITY_HEIGHT, false);
  applyGrade(node);

  const results: ParityResult[] = [];
  for (const scenario of PARITY_SCENARIOS) {
    const params = paramsFor(scenario);

    const driver = createComposerDriver(glsl, scene, camera, PARITY_WIDTH, PARITY_HEIGHT, DEFAULT_POST_TUNING);
    driver.setSize(PARITY_WIDTH, PARITY_HEIGHT, 1);
    driver.apply(params);
    driver.render();
    await settle();
    driver.render();
    const glslStats = frameStats(glsl.domElement);

    const outputPass = driver.composer.passes.find((p) => (p as { isOutputPass?: boolean }).isOutputPass);
    if (outputPass) outputPass.enabled = false;
    driver.render();
    const glslLinearLuma = frameStats(glsl.domElement).luma;
    driver.dispose();

    const pipeline = createNodePostPipeline(node, scene, camera, {
      bloom: scenario.bloom,
      ssao: false,
      godRays: false,
      chromatic: scenario.chromatic,
      aa: scenario.aa ?? 'none',
    });
    pipeline.update(params);
    pipeline.render();
    await settle();
    pipeline.render();
    const nodeStats = frameStats(node.domElement);
    pipeline.dispose();

    results.push({
      scenario: scenario.name,
      glslLuma: glslStats.luma,
      glslLinearLuma,
      nodeLuma: nodeStats.luma,
      relativeDelta: Math.abs(glslStats.luma - nodeStats.luma) / Math.max(nodeStats.luma, 1e-6),
      glslEdge: glslStats.edge,
      nodeEdge: nodeStats.edge,
    });
  }

  glsl.dispose();
  node.dispose();
  return results;
}
