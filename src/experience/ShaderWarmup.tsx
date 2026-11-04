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
 * with `?debug=1`, which ones — the list a new recipe is written from).
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { isScriptedInputMode } from '../input/scriptedRun';
import { queryFlags } from '../config/queryFlags';
import type * as THREE from 'three';
import type { WarmupRenderer } from '../rendering/shaderWarmup';
import type { ShaderWarmupSession } from './shaderWarmupRun';
import { useGameStore } from '../systems/GameState';
import { lazyModule } from '../utils/lazyModule';

/** The core + recipes + the factories they call: fetched while the menu is up. */
const warmupModule = lazyModule(() => import('./shaderWarmupRun'));

/** Sim seconds after Start over which the leftover compiles are counted. */
const RUN_PROGRAM_WINDOW_S = 3;

function programList(gl: unknown): { name?: string; cacheKey?: string }[] | null {
  const programs = (gl as { info?: { programs?: { name?: string; cacheKey?: string }[] | null } }).info?.programs;
  return Array.isArray(programs) ? programs : null;
}

function programCount(gl: unknown): number | null {
  return programList(gl)?.length ?? null;
}

export function ShaderWarmup({ worldEnabled }: { worldEnabled: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const loading = useProgress((s) => s.active);
  const quality = useGameStore((s) => s.settings.quality);
  const result = useRef<ShaderWarmupSession | null>(null);
  /** Set once the compile has landed: the next frame draws the warm frame (GLSL only). */
  const pendingFrame = useRef(false);
  const started = useRef<object | null>(null);
  const runWindow = useRef<{ at: number | null; before: Set<unknown>; elapsed: number } | null>(null);

  const eligible = !worldEnabled && !loading && !isScriptedInputMode();

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

  useEffect(() => {
    if (!eligible || started.current === gl) return;
    started.current = gl;
    const owner = gl;
    const renderer = gl as unknown as WarmupRenderer;
    void warmupModule
      .load()
      .then(async ({ runShaderWarmup, preloadWarmPasses }) => {
        const session = await runShaderWarmup(renderer, scene, camera, quality);
        await preloadWarmPasses(quality);
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
        const delta =
          warm.programsBefore !== null && warm.programsAfter !== null
            ? ` (+${warm.programsAfter - warm.programsBefore} programs)`
            : '';
        console.info(
          `[ShaderWarmup] ${warm.objects} objects compiled in ${Math.round(warm.ms)} ms${delta}` +
            (warm.failed.length ? `; skipped: ${warm.failed.join(', ')}` : ''),
        );
      })
      .catch((error: unknown) => console.warn('[ShaderWarmup] warm-up chunk failed to load', error));
    // quality / scene / camera seed the one warm-up per renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, gl]);

  useEffect(() => {
    runWindow.current = worldEnabled
      ? { at: programCount(gl), before: new Set(programList(gl) ?? []), elapsed: 0 }
      : null;
  }, [worldEnabled, gl]);

  // The warm frame: drawn here so R3F's own render (the menu has no post chain,
  // so R3F renders after every useFrame) overwrites it before it is presented.
  useFrame(() => {
    if (!pendingFrame.current) return;
    pendingFrame.current = false;
    const session = result.current;
    const mod = warmupModule.get();
    if (!session || !mod || worldEnabled) return;
    const before = programCount(gl);
    mod.renderShaderWarmup(gl as THREE.WebGLRenderer, session, camera, quality);
    const after = programCount(gl);
    if (before !== null && after !== null) {
      console.info(`[ShaderWarmup] warm frame compiled ${after - before} more programs (post chain, shadow depth, menu scene)`);
    }
  });

  useFrame((_, delta) => {
    const span = runWindow.current;
    if (!span || span.at === null) return;
    span.elapsed += delta;
    if (span.elapsed < RUN_PROGRAM_WINDOW_S) return;
    const now = programCount(gl);
    if (now !== null) {
      console.info(
        `[ShaderWarmup] first ${RUN_PROGRAM_WINDOW_S} s of the run compiled ${now - span.at} programs` +
          (result.current ? '' : ' (no warm-up ran)'),
      );
      // `?debug=1`: name them, so a missing warm-up recipe is one log line away.
      if (queryFlags().debug) {
        const fresh = (programList(gl) ?? []).filter((p) => !span.before.has(p));
        console.info('[ShaderWarmup] compiled in-run:', fresh.map((p) => p.name || (p.cacheKey ?? '?').slice(0, 48)).join(' | '));
      }
    }
    runWindow.current = null;
  });

  return null;
}
