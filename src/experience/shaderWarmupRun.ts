/**
 * shaderWarmupRun — the warm-up's code, as one lazy chunk (`ShaderWarmup.tsx`
 * imports it with `lazyModule`): the core, the recipes and the material
 * factories they call stay off the entry chunk's boot path, and the fetch
 * happens while the menu is up, which is when it runs.
 *
 * Two steps, because they need different contexts:
 *
 * 1. `runShaderWarmup` — `compileAsync` of every recipe (parallel link where
 *    `KHR_parallel_shader_compile` exists), against a warm *target* scene: the
 *    live scene's lights, cloned, and the fog the run will have. The menu has
 *    none (EnhancedSky's `<fog>` attaches to its group; TrackManager sets the
 *    scene's linear `THREE.Fog` at Start), and fog is baked into every program
 *    that reads it, so warming against the menu scene compiled the wrong ones.
 * 2. `renderShaderWarmup` — one frame drawn through a throwaway post chain with
 *    the run's passes, called from a `useFrame` so R3F's own menu render
 *    overwrites the canvas before it is presented. GLSL: an effect chain
 *    (`createComposerDriver`, detached after the draw). Node renderer: a node
 *    `RenderPipeline` (`createNodeDriver`, #576 A.3). That is what reaches the
 *    programs `compile()` cannot: every post pass (bloom mips, SSAO / GTAO, SMAA,
 *    the shader passes, the output transform), the shadow pass's depth
 *    materials, and the post-target variants of the recipes and of the menu's
 *    own objects (the sky), cloned so the live ones keep theirs. Before the
 *    node warm frame (#576 A.3) the TSL run compiled its whole post pipeline
 *    and every shadow depth material on its first frames: measured on the
 *    scripted meander, the frame adds 30 programs and the first 3 s drop 57 → 46.
 */
import * as THREE from 'three';
import { resolveMaterialBackend } from '../rendering/materialBackend';
import {
  warmShaderPrograms,
  warmupShadowModes,
  withShadowMode,
  type ShaderWarmupRecipe,
  type ShaderWarmupResult,
  type WarmupRenderer,
} from '../rendering/shaderWarmup';
import type { QualityPreset } from '../systems/GameState';
import { createComposerDriver, createNodeDriver, nodeStructureFor } from '../components/PostProcessingPipeline';
import type { WebGPURenderer } from 'three/webgpu';
import {
  DEFAULT_POST_TUNING,
  aaTierFor,
  computePostFrameParams,
  createPostSmoothedState,
} from '../components/postProcessing/postFrameParams';
import { smaaPassModule, ssaoPassModule } from '../components/postProcessing/composerPassModules';
import { effectsForLODQuality } from '../systems/settings/settingsDerive';
import { shaderWarmupRecipes } from './shaderWarmupRecipes';

/** The run's fog (TrackManager: `new THREE.Fog(color, 20, 150)`); only its type reaches a program. */
const RUN_FOG = () => new THREE.Fog(0xa5d6ff, 20, 150);

/** Composer size for the warm frame. Program keys do not depend on it. */
const WARM_FRAME_SIZE = 64;

export interface ShaderWarmupSession {
  readonly warm: ShaderWarmupResult;
  readonly targetScene: THREE.Scene;
  /**
   * Node renderer: releases the warm frame's `RenderPipeline` (its targets are
   * canvas-sized, unlike the GLSL chain's 64 px). Safe once the run's own
   * pipeline has drawn: node programs are shared by source, so the run's
   * materials already hold every program the warm one built. Idempotent; also
   * runs with `warm.dispose()`.
   */
  releaseFrame(): void;
  /** Hold something until `releaseFrame()` (the node warm frame's pipeline). */
  holdFrame(release: () => void): void;
}

/** Lights (cloned) and fog as the run will have them; nothing drawable. */
export function warmTargetScene(live: THREE.Scene): THREE.Scene {
  const target = new THREE.Scene();
  target.name = 'shader-warmup:target';
  target.fog = live.fog ?? RUN_FOG();
  target.environment = live.environment;
  live.traverseVisible((object) => {
    if ((object as THREE.Light).isLight) target.add(object.clone(false));
  });
  return target;
}

function cloneMaterial(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  return Array.isArray(material) ? material.map((m) => m.clone()) : material.clone();
}

/**
 * The menu's own drawables (sky, clouds, stars), with cloned materials: the
 * run draws them through the post chain's targets, a different program from
 * the menu's on-screen one, and a shared material would swap back on the next
 * menu frame and release it.
 */
function menuSceneRecipe(live: THREE.Scene): ShaderWarmupRecipe {
  return {
    id: 'menu-scene',
    build: () => {
      const clones: THREE.Object3D[] = [];
      live.traverseVisible((object) => {
        const drawable = object as THREE.Mesh;
        if (!(drawable.isMesh || (object as THREE.Points).isPoints) || !drawable.material) return;
        const clone = drawable.clone(false) as THREE.Mesh;
        clone.material = cloneMaterial(drawable.material);
        clone.frustumCulled = false;
        clones.push(clone);
      });
      return clones;
    },
  };
}

export async function runShaderWarmup(
  renderer: WarmupRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityPreset,
): Promise<ShaderWarmupSession> {
  const targetScene = warmTargetScene(scene);
  const warm = await warmShaderPrograms(renderer, {
    targetScene,
    camera,
    recipes: [...shaderWarmupRecipes(resolveMaterialBackend().backend), menuSceneRecipe(scene)],
    shadowModes: warmupShadowModes(quality),
  });
  const frameHolds: (() => void)[] = [];
  const releaseFrame = () => {
    for (const release of frameHolds.splice(0)) release();
  };
  warm.hold(releaseFrame);
  return { warm, targetScene, releaseFrame, holdFrame: (release) => frameHolds.push(release) };
}

/**
 * Preload the composer's lazy passes the preset will use, so the warm frame
 * builds them (a pass whose chunk is not loaded is skipped that frame).
 */
export async function preloadWarmPasses(quality: QualityPreset): Promise<void> {
  const presence = effectsForLODQuality(quality);
  await Promise.all([
    presence.ssao ? ssaoPassModule.load().catch(() => null) : null,
    aaTierFor(quality) === 'smaa' ? smaaPassModule.load().catch(() => null) : null,
  ]);
}

/** The renderer's bound target now, and a function that binds it again. */
function keepRenderTarget<T>(renderer: { getRenderTarget(): T; setRenderTarget(target: T): void }): () => void {
  const bound = renderer.getRenderTarget();
  return () => renderer.setRenderTarget(bound);
}

/**
 * Draw each shadow variant once through its own throwaway post chain: three's
 * effect list on `WebGLRenderer`, a node `RenderPipeline` on the node renderer.
 * Call from a `useFrame` that R3F's own render follows. GLSL chains are held by
 * `warm` and released with it — dropping a pass material would release its
 * program; node pipelines until `releaseFrame()`.
 */
export function renderShaderWarmup(
  gl: THREE.WebGLRenderer | WebGPURenderer,
  session: ShaderWarmupSession,
  camera: THREE.Camera,
  quality: QualityPreset,
): void {
  const { warm, targetScene } = session;
  const effectPresence = effectsForLODQuality(quality);
  const params = computePostFrameParams(
    {
      delta: 1 / 60,
      elapsed: 0,
      velocity: 0,
      waterfallIntensity: 0,
      isTightCanyon: false,
      biomeId: 'canyonSummer',
      weatherType: 'clear',
      timeOfDay: 0.5,
      sunWorldPosition: new THREE.Vector3(0, 30, -100),
      camera,
      quality,
      enableGodRays: true,
      volumetricSamples: 16,
      effectPresence,
      isRunner: true,
      sprintStamina: 1,
      boostActive: 0,
      boostIntensity: 0,
      aspectRatio: 16 / 9,
    },
    DEFAULT_POST_TUNING,
    createPostSmoothedState(),
  );
  // Warm every pass the preset may switch on, not only this frame's mood.
  params.godRays.enabled = params.godRays.allowed;

  const isNode = (gl as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
  const restoreTarget = isNode ? keepRenderTarget(gl as WebGPURenderer) : keepRenderTarget(gl as THREE.WebGLRenderer);
  for (const { mode, root } of warm.variants) {
    targetScene.add(root);
    try {
      withShadowMode(gl, mode, () => {
        if (isNode) {
          // Built against the warm target scene, so its scene pass draws the
          // recipes (and the cloned menu objects) into the run's scene target.
          const node = createNodeDriver(gl as WebGPURenderer, targetScene, camera, nodeStructureFor(params));
          if (!node) return;
          session.holdFrame(() => node.dispose());
          node.apply(params);
          node.render();
          return;
        }
        const webgl = gl as THREE.WebGLRenderer;
        const driver = createComposerDriver(webgl, targetScene, camera, WARM_FRAME_SIZE, WARM_FRAME_SIZE, DEFAULT_POST_TUNING);
        warm.hold(() => driver.dispose());
        driver.apply(params);
        webgl.shadowMap.needsUpdate = true;
        driver.render();
        // The renderer holds one effect list for every canvas render: the menu's
        // own frame must not run through this throwaway chain.
        driver.detach();
      });
    } catch (error) {
      console.warn(`[ShaderWarmup] warm frame (${mode} shadows) failed`, error);
    } finally {
      targetScene.remove(root);
      restoreTarget();
    }
  }
  // The cloned lights' shadow maps were only for this frame.
  targetScene.traverse((object) => {
    (object as THREE.DirectionalLight).shadow?.dispose?.();
  });
}
