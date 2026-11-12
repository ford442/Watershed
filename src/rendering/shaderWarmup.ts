/**
 * shaderWarmup — compile the programs the first seconds of a run need while
 * the boot loader / menu is up, instead of synchronously on the frame they
 * first draw.
 *
 * three r185 `compileAsync(scene, camera, targetScene)` builds every material
 * in `scene` against the lights (and fog) of `targetScene` and resolves when
 * the driver reports them linked — over `KHR_parallel_shader_compile` where it
 * exists, so the link happens off the main thread. The warm scene is a
 * throwaway group with one object per material variant (recipes live with the
 * scene: `experience/shaderWarmupRecipes.ts`); the target is the live scene, so
 * the light state is the pooled one (`sceneLightPool.tsx`) the run will have.
 *
 * Two details decide whether a warmed program is the one the run uses:
 *
 * - **Render target.** three bakes tone mapping and the output colour space
 *   into each program, and uses `NoToneMapping` + linear output whenever it
 *   renders into a target. Every scene draw goes through the post chain's
 *   targets, so the GLSL compile runs with a throwaway target bound.
 * - **Shadow map type.** Baked in as `SHADOWMAP_TYPE_*`. A High → Medium drop
 *   flips `soft` → `basic`, which used to recompile every lit program on the
 *   frame the valve moved — exactly when frame time was already bad. Each
 *   requested shadow variant gets its own material instances (a material holds
 *   one program; recompiling it under another type would release the first).
 *
 * The warm objects stay alive until `dispose()`: three refcounts programs per
 * material, and dropping the last holder destroys the program before the run
 * ever asks for it.
 */
import * as THREE from 'three';
import { telemetryNowMs } from '../utils/wallClock';
import { shadowMapTypeFor, type ShadowMode } from './deriveRendererContextOptions';
import { liveProgramCount } from './programCount';

/** One material variant, built fresh for each shadow variant. */
export interface ShaderWarmupRecipe {
  readonly id: string;
  build(): THREE.Object3D | THREE.Object3D[] | null;
}

/** The slice of a renderer the warm-up drives (WebGLRenderer or the node renderer). */
export interface WarmupRenderer {
  compileAsync(scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null): Promise<unknown>;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
  getRenderTarget?(): THREE.WebGLRenderTarget | null;
  setRenderTarget?(target: THREE.WebGLRenderTarget | null): void;
  info?: { programs?: readonly unknown[] | null };
  isWebGPURenderer?: boolean;
}

export interface ShaderWarmupOptions {
  /** The scene whose lights and fog the programs are built against. */
  targetScene: THREE.Scene;
  camera: THREE.Camera;
  recipes: readonly ShaderWarmupRecipe[];
  /** Shadow modes to build variants for, in order. Duplicates are dropped. */
  shadowModes: readonly ShadowMode[];
}

export interface ShaderWarmupResult {
  /** Recipe objects compiled, across every shadow variant. */
  objects: number;
  /** Recipes that threw while building (skipped, not fatal). */
  failed: string[];
  /**
   * Live programs before / after (`liveProgramCount`: GLSL `info.programs`, node
   * pipelines); null where the renderer does not list them.
   */
  programsBefore: number | null;
  programsAfter: number | null;
  ms: number;
  /** Each shadow variant's warm group (for a follow-up warm render). */
  readonly variants: ReadonlyArray<{ mode: ShadowMode; root: THREE.Group }>;
  /** Hold something else until `dispose()` (a warm render's post chain). */
  hold(release: () => void): void;
  /** Release the warm materials (their programs survive while the run holds them). */
  dispose(): void;
}

/**
 * Run `fn` with the renderer's shadow map set as `mode` means, then put the
 * previous state back. Exported for the warm render, which needs the same
 * per-variant state as the compile.
 */
export function withShadowMode<T>(renderer: Pick<WarmupRenderer, 'shadowMap'>, mode: ShadowMode, fn: () => T): T {
  const previous = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type };
  const shadow = shadowStateFor(mode);
  renderer.shadowMap.enabled = shadow.enabled;
  if (shadow.type !== null) renderer.shadowMap.type = shadow.type;
  try {
    return fn();
  } finally {
    renderer.shadowMap.enabled = previous.enabled;
    renderer.shadowMap.type = previous.type;
  }
}

/** The `shadowMap` state a shadow mode means (`applyRendererContextOptions`). */
export function shadowStateFor(mode: ShadowMode): { enabled: boolean; type: THREE.ShadowMapType | null } {
  if (mode === 'off') return { enabled: false, type: null };
  return { enabled: true, type: shadowMapTypeFor(mode) };
}

/**
 * The shadow modes worth warming for a preset: its own, then the next preset
 * down's — the one step the adaptive valve takes under load.
 */
export function warmupShadowModes(quality: 'low' | 'medium' | 'high' | 'ultra'): ShadowMode[] {
  const ladder: Record<typeof quality, ShadowMode[]> = {
    ultra: ['soft'],
    high: ['soft', 'basic'],
    medium: ['basic', 'off'],
    low: ['off'],
  };
  return ladder[quality];
}


function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      for (const value of Object.values(m)) {
        if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
      }
      m.dispose();
    }
  });
}

/**
 * Compile every recipe under every requested shadow mode. Never throws: a
 * recipe that fails to build is skipped and named in `failed`, and a renderer
 * without `compileAsync` resolves with nothing compiled.
 */
export async function warmShaderPrograms(
  renderer: WarmupRenderer,
  options: ShaderWarmupOptions,
): Promise<ShaderWarmupResult> {
  const started = telemetryNowMs();
  const programsBefore = liveProgramCount(renderer);
  const variants: { mode: ShadowMode; root: THREE.Group }[] = [];
  const held: (() => void)[] = [];
  const failed = new Set<string>();
  let objects = 0;
  const pending: Promise<unknown>[] = [];

  const isNode = renderer.isWebGPURenderer === true;
  const previousTarget = renderer.getRenderTarget?.() ?? null;
  // GLSL: compile as the post chain draws — into a target (see the header).
  const target = !isNode && renderer.setRenderTarget
    ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true })
    : null;

  try {
    for (const mode of new Set(options.shadowModes)) {
      const group = new THREE.Group();
      group.name = `shader-warmup:${mode}`;
      for (const recipe of options.recipes) {
        try {
          const built = recipe.build();
          const list = built === null ? [] : Array.isArray(built) ? built : [built];
          for (const object of list) {
            group.add(object);
            objects += 1;
          }
        } catch (error) {
          failed.add(recipe.id);
          console.warn(`[ShaderWarmup] recipe ${recipe.id} failed to build`, error);
        }
      }
      variants.push({ mode, root: group });

      withShadowMode(renderer, mode, () => {
        if (target) renderer.setRenderTarget?.(target);
        try {
          // compile() runs synchronously inside compileAsync, under the state
          // set above; only the readiness poll is asynchronous.
          pending.push(
            renderer.compileAsync(group, options.camera, options.targetScene).catch((error: unknown) => {
              console.warn(`[ShaderWarmup] compile (${mode} shadows) failed`, error);
            }),
          );
        } finally {
          if (target) renderer.setRenderTarget?.(previousTarget);
        }
      });
    }
    await Promise.all(pending);
  } catch (error) {
    console.warn('[ShaderWarmup] warm-up aborted', error);
  } finally {
    target?.dispose();
  }

  let disposed = false;
  return {
    objects,
    failed: [...failed],
    programsBefore,
    programsAfter: liveProgramCount(renderer),
    ms: telemetryNowMs() - started,
    variants,
    hold(release) {
      if (disposed) release();
      else held.push(release);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const release of held.splice(0)) release();
      for (const { root } of variants) disposeObject(root);
    },
  };
}
