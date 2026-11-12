/**
 * postParity — one deterministic frame through both post drivers (#466 Phase A).
 *
 * The game can't serve as a headless reference frame (SwiftShader starves it and
 * the run never advances), so this builds a fixed lit scene and renders it with:
 *   - the GLSL driver (`renderer.setEffects` over three's HalfFloat output) on
 *     `THREE.WebGLRenderer`, and
 *   - the node `RenderPipeline` on `WebGPURenderer({ forceWebGL: true })`,
 * with the same frozen `PostFrameParams`, then compares Rec.709 mean luma of the
 * presented (tone-mapped, sRGB-encoded) pixels. Driven by
 * `verification/post_parity.mjs` through `verification/post_parity.html`.
 *
 * SSAO stays off: GTAO and SSAOPass are different algorithms, and the point
 * here is the grade (one tone-map + one sRGB encode at the end). God rays run
 * in one scenario: the node port is line-for-line, and the GLSL pass once
 * discarded the scene under its rays (it blended onto the stale ping-pong
 * target), which no per-pass test could see.
 */
import * as THREE from 'three';
import { createComposerDriver } from '../components/PostProcessingPipeline';
import { createNodePostPipeline } from '../components/postProcessing/nodePostPipeline';
import {
  DEFAULT_POST_TUNING,
  linearVignetteDarkness,
  type PostFrameParams,
} from '../components/postProcessing/postFrameParams';
import {
  FrameReadback,
  PARITY_HEIGHT,
  PARITY_WIDTH,
  applyGrade,
  createGlslParityRenderer,
  createNodeParityRenderer,
  settle,
} from './parityFrame';

/** The dual host these scenarios gate (scripts/check-glsl-hosts.mjs reads it). */
export const POST_PARITY_HOSTS = ['src/components/PostProcessingPipeline.tsx'] as const;

export interface ParityScenario {
  name: string;
  aa?: 'none' | 'smaa';
  bloom: boolean;
  chromatic: boolean;
  vignette: boolean;
  saturation: number;
  godRays?: boolean;
}

export const PARITY_SCENARIOS: ParityScenario[] = [
  { name: 'grade', bloom: false, chromatic: false, vignette: true, saturation: 0 },
  { name: 'grade+desaturate', bloom: false, chromatic: true, vignette: true, saturation: -0.3 },
  { name: 'bloom', bloom: true, chromatic: false, vignette: true, saturation: 0 },
  // SMAA moves the node path's output transform inside the graph (#466 Phase C):
  // the grade must not change with it.
  { name: 'grade+smaa', aa: 'smaa', bloom: true, chromatic: false, vignette: true, saturation: 0 },
  // Rays only add light: the scene underneath must survive (verification/post_parity.mjs).
  { name: 'god rays', godRays: true, bloom: false, chromatic: false, vignette: true, saturation: 0 },
];

export interface ParityResult {
  scenario: string;
  glslLuma: number;
  /** The GLSL chain with three's grade switched off — the pre-#466 image. */
  glslLinearLuma: number;
  nodeLuma: number;
  /** |glsl − node| / max(node, ε). */
  relativeDelta: number;
  /** Mean |Δluma| between horizontal neighbours, per driver — edge AA lowers it. */
  glslEdge: number;
  nodeEdge: number;
  /** PNG data URLs of the presented frames (`POST_PARITY_SHOTS` writes them out). */
  glslPng: string;
  nodePng: string;
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
      allowed: s.godRays === true,
      enabled: s.godRays === true,
      // Top-left origin, on the glow sphere — the bright source the rays march toward.
      sunScreenPosition: new THREE.Vector2(0.72, 0.3),
      sunColor: new THREE.Color('#fff4e0'),
      intensity: s.godRays ? 0.6 : 0,
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

export async function runPostParity(): Promise<ParityResult[]> {
  const { scene, camera } = buildScene();

  const glsl = createGlslParityRenderer();
  const node = await createNodeParityRenderer();
  const readback = new FrameReadback();
  const frameStats = (canvas: HTMLCanvasElement) => {
    readback.capture(canvas);
    return readback.stats();
  };

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
    const glslPng = readback.png();

    // three's final blit with no grade: tone map off, linear output — the pre-#466 image.
    glsl.toneMapping = THREE.NoToneMapping;
    glsl.outputColorSpace = THREE.LinearSRGBColorSpace;
    driver.render();
    const glslLinearLuma = frameStats(glsl.domElement).luma;
    applyGrade(glsl);
    driver.dispose();

    const pipeline = createNodePostPipeline(node, scene, camera, {
      bloom: scenario.bloom,
      ssao: false,
      godRays: scenario.godRays === true,
      chromatic: scenario.chromatic,
      aa: scenario.aa ?? 'none',
    });
    pipeline.update(params);
    pipeline.render();
    await settle();
    pipeline.render();
    const nodeStats = frameStats(node.domElement);
    const nodePng = readback.png();
    pipeline.dispose();

    results.push({
      scenario: scenario.name,
      glslLuma: glslStats.luma,
      glslLinearLuma,
      nodeLuma: nodeStats.luma,
      relativeDelta: Math.abs(glslStats.luma - nodeStats.luma) / Math.max(nodeStats.luma, 1e-6),
      glslEdge: glslStats.edge,
      nodeEdge: nodeStats.edge,
      glslPng,
      nodePng,
    });
  }

  glsl.dispose();
  node.dispose();
  return results;
}
