/**
 * ShaderWarmup — compiles the run's first-second programs during the boot
 * loader / menu (#466 audit, Phase B). Renders nothing; lives inside <Canvas>.
 *
 * Starts once per renderer when the loader is idle and the world is not yet
 * mounted (the menu): `compileAsync` of the recipes against the live scene's
 * (cloned) pooled lights and the run's fog, then one warm frame through a
 * throwaway composer on the next `useFrame` (`shaderWarmupRun.ts`). Off under
 * scripted input (`?input=script:` / `?replay=`): the deterministic smokes run
 * with `frameloop="never"` and must not gain a compile pass.
 *
 * It also measures what it is for: the number of programs the first 3 s of
 * sim time after Start still had to compile, logged once per run start (and,
 * with `?debug=1`, which ones — the list a new recipe is written from). Both
 * backends count (`liveProgramCount`: GLSL programs, node pipelines), and the
 * numbers land in the `shaderWarmup` debug tap, which
 * `verification/shader_warmup_report.mjs` reads for each backend under
 * `?warmup=1` (the one way to run the warm-up under scripted input).
 */
import { useEffect, useRef } from 'react';
import { traceEnd, traceName, traceStart } from '../debug/trace/traceProbe';
import { useFrame, useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { isScriptedInputMode } from '../input/scriptedRun';
import { queryFlags } from '../config/queryFlags';
import { setDebugTap, type ShaderWarmupTap } from '../debug/debugTaps';
import { resolveMaterialBackend } from '../rendering/materialBackend';
import { liveProgramCount, liveProgramLabel, liveProgramList } from '../rendering/programCount';
import type * as THREE from 'three';
import type { WarmupRenderer } from '../rendering/shaderWarmup';
import type { ShaderWarmupSession } from './shaderWarmupRun';
import { useGameStore, type QualityPreset } from '../systems/GameState';
import { lazyModule } from '../utils/lazyModule';

/** The core + recipes + the factories they call: fetched while the menu is up. */
const warmupModule = lazyModule(() => import('./shaderWarmupRun'));

/**
 * The trace timeline (#559 D): the async compile on its own track (it spans
 * many frames), the warm frame on the main thread's.
 */
const WARMUP_SPAN = traceName('shader-warmup', 'warmup');
const WARM_FRAME_SPAN = traceName('shader-warm-frame');

/** Sim seconds after Start over which the leftover compiles are counted. */
const RUN_PROGRAM_WINDOW_S = 3;

/**
 * Draw the warm frame (GLSL only) and record what it compiled. The warm-up
 * module is loaded by the time a session exists.
 */
function drawWarmFrame(
  gl: unknown,
  session: ShaderWarmupSession,
  camera: THREE.Camera,
  quality: QualityPreset,
  tap: ShaderWarmupTap | null,
): void {
  const mod = warmupModule.get();
  if (!mod) return;
  const before = liveProgramCount(gl);
  const traced = traceStart();
  mod.renderShaderWarmup(gl as THREE.WebGLRenderer, session, camera, quality);
  traceEnd(WARM_FRAME_SPAN, traced);
  const after = liveProgramCount(gl);
  if (before !== null && after !== null) {
    if (tap) tap.warmFrame = after - before;
    console.info(`[ShaderWarmup] warm frame compiled ${after - before} more programs (post chain, shadow depth, menu scene)`);
  }
}

/** The tap is a reference: harness reads see each field as it lands. */
function warmupTap(): ShaderWarmupTap {
  const tap: ShaderWarmupTap = { backend: resolveMaterialBackend().backend, warm: null, warmFrame: null, firstRun: null };
  setDebugTap('shaderWarmup', tap);
  return tap;
}

export function ShaderWarmup({ worldEnabled }: { worldEnabled: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const getRoot = useThree((s) => s.get);
  const loading = useProgress((s) => s.active);
  const quality = useGameStore((s) => s.settings.quality);
  const result = useRef<ShaderWarmupSession | null>(null);
  /** Set once the compile has landed: the next frame draws the warm frame (GLSL only). */
  const pendingFrame = useRef(false);
  const started = useRef<object | null>(null);
  const runWindow = useRef<{ at: number | null; before: Set<unknown>; elapsed: number } | null>(null);
  const tap = useRef<ShaderWarmupTap | null>(null);

  // Off under scripted input (the deterministic smokes) unless `?warmup=1` asks.
  const eligible = !worldEnabled && !loading && (!isScriptedInputMode() || queryFlags().warmup);

  // The warm materials hold their programs; release them with the renderer.
  // Cancellation follows the renderer's lifetime only — not `eligible`, which
  // flickers whenever the loading manager picks up another asset.
  const alive = useRef<object | null>(null);
  useEffect(() => {
    alive.current = gl;
    return () => {
      alive.current = null;
      result.current?.warm.dispose();
      result.current = null;
      pendingFrame.current = false;
    };
  }, [gl]);

  // quality / scene / camera seed the one warm-up per renderer: read through a ref
  // (the latest render's values) so a change to one does not re-run it.
  const seed = useRef({ scene, camera, quality });
  seed.current.scene = scene;
  seed.current.camera = camera;
  seed.current.quality = quality;

  useEffect(() => {
    if (!eligible || started.current === gl) return;
    const { scene: warmScene, camera: warmCamera, quality: warmQuality } = seed.current;
    started.current = gl;
    const owner = gl;
    const renderer = gl as unknown as WarmupRenderer;
    tap.current = warmupTap();
    const traced = traceStart();
    void warmupModule
      .load()
      .then(async ({ runShaderWarmup, preloadWarmPasses }) => {
        const session = await runShaderWarmup(renderer, warmScene, warmCamera, warmQuality);
        await preloadWarmPasses(warmQuality);
        traceEnd(WARMUP_SPAN, traced);
        return session;
      })
      .then((session) => {
        const { warm } = session;
        if (alive.current !== owner) {
          warm.dispose();
          return;
        }
        result.current = session;
        pendingFrame.current = !renderer.isWebGPURenderer;
        if (tap.current) {
          tap.current.warm = {
            objects: warm.objects,
            programs: warm.programsBefore !== null && warm.programsAfter !== null ? warm.programsAfter - warm.programsBefore : null,
            ms: warm.ms,
            failed: warm.failed,
          };
        }
        const delta =
          warm.programsBefore !== null && warm.programsAfter !== null
            ? ` (+${warm.programsAfter - warm.programsBefore} programs)`
            : '';
        console.info(
          `[ShaderWarmup] ${warm.objects} objects compiled in ${Math.round(warm.ms)} ms${delta}` +
            (warm.failed.length ? `; skipped: ${warm.failed.join(', ')}` : ''),
        );
        // `frameloop="never"` (a scripted page under `?warmup=1`) draws no menu
        // frame for the useFrame below, and presents nothing a warm frame could
        // flash into: draw it now.
        if (pendingFrame.current && getRoot().frameloop === 'never') {
          pendingFrame.current = false;
          drawWarmFrame(gl, session, seed.current.camera, seed.current.quality, tap.current);
        }
      })
      .catch((error: unknown) => console.warn('[ShaderWarmup] warm-up chunk failed to load', error));
  }, [eligible, gl, getRoot]);

  useEffect(() => {
    runWindow.current = worldEnabled
      ? { at: liveProgramCount(gl), before: new Set(liveProgramList(gl) ?? []), elapsed: 0 }
      : null;
  }, [worldEnabled, gl]);

  // The warm frame: drawn here so R3F's own render (the menu has no post chain,
  // so R3F renders after every useFrame) overwrites it before it is presented.
  useFrame(() => {
    if (!pendingFrame.current) return;
    pendingFrame.current = false;
    const session = result.current;
    if (!session || worldEnabled) return;
    drawWarmFrame(gl, session, camera, quality, tap.current);
  });

  useFrame((_, delta) => {
    const span = runWindow.current;
    if (!span || span.at === null) return;
    span.elapsed += delta;
    if (span.elapsed < RUN_PROGRAM_WINDOW_S) return;
    const now = liveProgramCount(gl);
    if (now !== null) {
      const compiled = now - span.at;
      // A run without a warm-up still reports (the backend's cold number).
      const runTap = tap.current ?? warmupTap();
      tap.current = runTap;
      runTap.firstRun = compiled;
      console.info(
        `[ShaderWarmup] first ${RUN_PROGRAM_WINDOW_S} s of the run compiled ${compiled} programs (${runTap.backend})` +
          (result.current ? '' : ' (no warm-up ran)'),
      );
      // `?debug=1`: name them, so a missing warm-up recipe is one log line away.
      if (queryFlags().debug) {
        const fresh = (liveProgramList(gl) ?? []).filter((p) => !span.before.has(p));
        console.info('[ShaderWarmup] compiled in-run:', fresh.map(liveProgramLabel).join(' | '));
      }
    }
    runWindow.current = null;
  });

  return null;
}
