/**
 * segmentFrames — live geometry of the active treadmill segments, in world space.
 *
 * The treadmill descends: every map's centreline drops tens of metres per
 * segment (meander's waterfall sits ~900 m below the spawn at the default
 * seed), and `?seed=` moves every segment in all three axes. Anything authored
 * as an absolute world coordinate — an OOB `y < -80` clip, a `safeZone`
 * y-range, a cache waypoint's `[x, y, z]` — is therefore wrong a few segments
 * in, and differently wrong per seed.
 *
 * This module is the single place that turns segment-relative authoring into
 * world space, against the path the player is actually standing on:
 *
 *   - `resolveSegmentEnvelope` — vertical OOB bounds for the segment under the
 *     player. An authored `safeZone` is relative to that segment's centreline
 *     (`yMin` below its lowest point, `yMax` above its highest — or its
 *     upstream neighbour's, whichever is higher); segments
 *     without one get the global fallback margins, anchored the same way.
 *   - `resolveSegmentAnchor` — a waypoint placed at a path parameter `t` with a
 *     lateral offset, rather than at a guessed world position.
 *
 * TrackManager publishes the active set on every pool change. Readers poll it
 * (per frame, 10 Hz) — no Zustand writes.
 */

import type { SafeZoneConfig } from './MapSystem.types';

type Vec3Tuple = readonly [number, number, number];

/** Centreline samples kept per segment (t = 0, 1/N, …, 1). */
export const FRAME_SAMPLES = 32;

export interface SegmentFrame {
  index: number;
  /** Centreline z at t = 0 / t = 1. Downstream is −z, so zStart > zEnd. */
  zStart: number;
  zEnd: number;
  /** Centreline y range over the whole segment. */
  pathYMin: number;
  pathYMax: number;
  /** Centreline samples, evenly spaced in t. */
  samples: ReadonlyArray<Vec3Tuple>;
  /** Authored envelope, segment-relative (see SafeZoneConfig). */
  safeZone?: SafeZoneConfig;
}

/** Anything with a Catmull-Rom style `getPoint(t)` — THREE.Curve satisfies it. */
export interface CurveLike {
  getPoint(t: number): { x: number; y: number; z: number };
}

export function buildSegmentFrame(
  index: number,
  curve: CurveLike,
  safeZone?: SafeZoneConfig | null,
): SegmentFrame {
  const samples: Vec3Tuple[] = [];
  let pathYMin = Infinity;
  let pathYMax = -Infinity;
  for (let i = 0; i <= FRAME_SAMPLES; i += 1) {
    const p = curve.getPoint(i / FRAME_SAMPLES);
    samples.push([p.x, p.y, p.z]);
    pathYMin = Math.min(pathYMin, p.y);
    pathYMax = Math.max(pathYMax, p.y);
  }
  return {
    index,
    zStart: samples[0][2],
    zEnd: samples[samples.length - 1][2],
    pathYMin,
    pathYMax,
    samples,
    ...(safeZone ? { safeZone } : {}),
  };
}

/**
 * The frame whose z span contains `z`; otherwise the nearest one by z. Only
 * null when there are no frames at all.
 */
export function findSegmentFrameAtZ(
  frames: ReadonlyArray<SegmentFrame>,
  z: number,
): SegmentFrame | null {
  let nearest: SegmentFrame | null = null;
  let nearestDistance = Infinity;
  for (const frame of frames) {
    const hi = Math.max(frame.zStart, frame.zEnd);
    const lo = Math.min(frame.zStart, frame.zEnd);
    if (z <= hi && z >= lo) return frame;
    const distance = z > hi ? z - hi : lo - z;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = frame;
    }
  }
  return nearest;
}

export interface VerticalBounds {
  yMin: number;
  yMax: number;
}

export interface SegmentEnvelope extends VerticalBounds {
  /** Segment the envelope was resolved against; null when no frame is live. */
  segmentIndex: number | null;
  /** True when the segment authors a `safeZone` (not the global fallback). */
  authored: boolean;
  /** Authored respawn segment for an OOB on this segment. */
  respawnAt?: number;
}

/**
 * World-space vertical bounds for a player at `pos`.
 *
 * `fallback` is the global margin pair (runner `POSITION_SANE`). With a live
 * frame it is applied relative to the centreline like an authored safeZone;
 * with no frames (boot, before the pool exists) it is used as absolute world y,
 * which is where the player spawns anyway.
 */
export function resolveSegmentEnvelope(
  frames: ReadonlyArray<SegmentFrame>,
  pos: { z: number },
  fallback: VerticalBounds,
): SegmentEnvelope {
  const frame = findSegmentFrameAtZ(frames, pos.z);
  if (!frame) {
    return { yMin: fallback.yMin, yMax: fallback.yMax, segmentIndex: null, authored: false };
  }
  const zone = frame.safeZone;
  const margins = zone ?? fallback;
  // The ceiling also clears the upstream neighbour's top: a runner launched off
  // a waterfall lip carries forward momentum and crosses into the next
  // segment's (short) z span while still up at lip height.
  const upstream = frames.find((candidate) => candidate.index === frame.index - 1);
  const ceiling = Math.max(frame.pathYMax, upstream?.pathYMax ?? -Infinity);
  return {
    yMin: frame.pathYMin + margins.yMin,
    yMax: ceiling + margins.yMax,
    segmentIndex: frame.index,
    authored: Boolean(zone),
    ...(zone?.respawnAt !== undefined ? { respawnAt: zone.respawnAt } : {}),
  };
}

/**
 * A waypoint placed on a segment rather than at a world coordinate.
 *
 * `lateral` is metres to the right of the downstream direction (negative =
 * left bank), measured horizontally; `rise` lifts the marker above the
 * centreline. Resolved against the live segment, so it follows `?seed=`.
 */
export interface SegmentAnchor {
  /** Path parameter along the segment, 0–1. */
  t: number;
  lateral: number;
  rise?: number;
}

export function resolveSegmentAnchor(
  frame: SegmentFrame,
  anchor: SegmentAnchor,
): [number, number, number] {
  const { samples } = frame;
  const t = Math.min(1, Math.max(0, anchor.t));
  const f = t * (samples.length - 1);
  const i = Math.min(samples.length - 2, Math.floor(f));
  const k = f - i;
  const a = samples[i];
  const b = samples[i + 1];
  const x = a[0] + (b[0] - a[0]) * k;
  const y = a[1] + (b[1] - a[1]) * k;
  const z = a[2] + (b[2] - a[2]) * k;

  // Horizontal right vector = tangent × up. A waterfall's tangent is nearly
  // vertical; its horizontal part still points downstream, so normalise that.
  let tx = b[0] - a[0];
  let tz = b[2] - a[2];
  const len = Math.hypot(tx, tz);
  if (len < 1e-6) {
    tx = 0;
    tz = -1;
  } else {
    tx /= len;
    tz /= len;
  }
  const rightX = -tz;
  const rightZ = tx;

  return [x + rightX * anchor.lateral, y + (anchor.rise ?? 0), z + rightZ * anchor.lateral];
}

// ---------------------------------------------------------------------------
// Active-set registry (published by TrackManager)
// ---------------------------------------------------------------------------

let activeFrames: SegmentFrame[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function publishSegmentFrames(frames: SegmentFrame[]): void {
  activeFrames = frames;
  version += 1;
  for (const listener of listeners) listener();
}

export function clearSegmentFrames(): void {
  publishSegmentFrames([]);
}

export function getSegmentFrames(): ReadonlyArray<SegmentFrame> {
  return activeFrames;
}

export function getSegmentFrame(index: number): SegmentFrame | null {
  return activeFrames.find((frame) => frame.index === index) ?? null;
}

/** Bumps on every publish — `useSyncExternalStore` snapshot. */
export function getSegmentFramesVersion(): number {
  return version;
}

export function subscribeSegmentFrames(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
