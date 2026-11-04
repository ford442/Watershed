/**
 * frameRenderInfo — `renderer.info` over the whole frame, not its last pass.
 *
 * three resets `info.render` inside every `render()` call while
 * `info.autoReset` is true (r185 `WebGLRenderer.js:1702`). The post chain issues
 * 6–9 renders per frame (scene, SSAO, god rays, bloom mips, the shader passes,
 * OutputPass, SMAA) plus the planar reflection, so a reader saw only the final
 * fullscreen quad — two triangles, one call — and the debug panel under-reported
 * by the whole scene pass.
 *
 * `attachFrameRenderInfo` turns `autoReset` off for the renderer it is given
 * and brackets every frame with R3F's global effects: `info.reset()` once
 * before any `useFrame` runs, and a snapshot once every root (and the post
 * chain's manual render) is done. Readers take the snapshot: `info.render`
 * itself is mid-frame whenever a `useFrame` looks at it.
 *
 * The flag is owned here, by the thing that resets, rather than set at renderer
 * creation: a Canvas that never mounts this (the Level Editor) keeps three's
 * per-render reset instead of counters that grow forever.
 */
import { addAfterEffect, addEffect } from '@react-three/fiber';

/** The subset of WebGLRenderer / WebGPURenderer `info` this reads. */
export interface RendererInfoLike {
  autoReset: boolean;
  reset(): void;
  render: { calls: number; triangles: number; points: number; lines: number };
  /** WebGLRenderer only: one entry per live program. */
  programs?: readonly unknown[] | null;
}

export interface FrameRenderInfo {
  /** Frames snapshotted since attach. */
  frame: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  /** Live GL programs after the frame; null where the renderer does not list them. */
  programs: number | null;
}

const snapshot: FrameRenderInfo = {
  frame: 0,
  calls: 0,
  triangles: 0,
  points: 0,
  lines: 0,
  programs: null,
};

/** The last completed frame's totals. Mutated in place — copy to keep. */
export function getFrameRenderInfo(): Readonly<FrameRenderInfo> {
  return snapshot;
}

/** Copy `info` into the snapshot. Exported for tests. */
export function captureFrameRenderInfo(info: RendererInfoLike): void {
  snapshot.frame += 1;
  snapshot.calls = info.render.calls;
  snapshot.triangles = info.render.triangles;
  snapshot.points = info.render.points;
  snapshot.lines = info.render.lines;
  snapshot.programs = Array.isArray(info.programs) ? info.programs.length : null;
}

type EffectRegistrar = (callback: (timestamp: number) => void) => () => void;

/**
 * Own `info.autoReset` for one renderer. Returns the detach, which restores
 * three's per-render reset.
 */
export function attachFrameRenderInfo(
  info: RendererInfoLike,
  register: { before: EffectRegistrar; after: EffectRegistrar } = {
    before: addEffect,
    after: addAfterEffect,
  },
): () => void {
  const previous = info.autoReset;
  info.autoReset = false;
  info.reset();
  snapshot.frame = 0;
  const removeBefore = register.before(() => info.reset());
  const removeAfter = register.after(() => captureFrameRenderInfo(info));
  return () => {
    removeBefore();
    removeAfter();
    info.autoReset = previous;
  };
}
