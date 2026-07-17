/**
 * ghostPlayback.ts — Catmull-Rom position + slerp quaternion interpolation for ghost replay.
 */

import * as THREE from 'three';
import {
  decodeGhostFromBase64,
  GHOST_FLOATS_PER_SAMPLE,
  GHOST_SAMPLE_HZ,
  type DecodedGhost,
  type GhostSample,
} from './ghostCodec';

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _p3 = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]);

const _scratchA: GhostSample = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const _scratchB: GhostSample = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const _scratchC: GhostSample = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const _scratchD: GhostSample = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

export interface GhostPose {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

function readSample(samples: Float32Array, index: number, out: GhostSample): GhostSample {
  const maxIndex = samples.length / GHOST_FLOATS_PER_SAMPLE - 1;
  const clamped = Math.max(0, Math.min(index, maxIndex));
  const offset = clamped * GHOST_FLOATS_PER_SAMPLE;
  out.px = samples[offset];
  out.py = samples[offset + 1];
  out.pz = samples[offset + 2];
  out.qx = samples[offset + 3];
  out.qy = samples[offset + 4];
  out.qz = samples[offset + 5];
  out.qw = samples[offset + 6];
  return out;
}

export function loadGhostFromBase64(payload: string | undefined): DecodedGhost | null {
  if (!payload) return null;
  return decodeGhostFromBase64(payload);
}

/** Interpolate ghost pose at playback time (seconds since run start). */
export function interpolateGhost(
  ghost: DecodedGhost,
  playbackTimeSec: number,
  out: GhostPose = {
    px: 0,
    py: 0,
    pz: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  },
): GhostPose | null {
  const { samples, sampleCount } = ghost;
  if (sampleCount <= 0) return null;

  const maxTime = (sampleCount - 1) / GHOST_SAMPLE_HZ;
  const t = Math.max(0, Math.min(playbackTimeSec, maxTime));
  const floatIndex = t * GHOST_SAMPLE_HZ;
  const i1 = Math.floor(floatIndex);
  const frac = floatIndex - i1;

  if (sampleCount === 1) {
    return readSample(samples, 0, out);
  }

  if (sampleCount < 4) {
    const a = readSample(samples, i1, _scratchA);
    const b = readSample(samples, Math.min(i1 + 1, sampleCount - 1), _scratchB);
    out.px = THREE.MathUtils.lerp(a.px, b.px, frac);
    out.py = THREE.MathUtils.lerp(a.py, b.py, frac);
    out.pz = THREE.MathUtils.lerp(a.pz, b.pz, frac);
    _quatA.set(a.qx, a.qy, a.qz, a.qw);
    _quatB.set(b.qx, b.qy, b.qz, b.qw);
    _quatA.slerp(_quatB, frac);
    out.qx = _quatA.x;
    out.qy = _quatA.y;
    out.qz = _quatA.z;
    out.qw = _quatA.w;
    return out;
  }

  const i0 = Math.max(0, i1 - 1);
  const i2 = Math.min(sampleCount - 1, i1 + 1);
  const i3 = Math.min(sampleCount - 1, i1 + 2);

  const s0 = readSample(samples, i0, _scratchA);
  const s1 = readSample(samples, i1, _scratchB);
  const s2 = readSample(samples, i2, _scratchC);
  const s3 = readSample(samples, i3, _scratchD);

  _p0.set(s0.px, s0.py, s0.pz);
  _p1.set(s1.px, s1.py, s1.pz);
  _p2.set(s2.px, s2.py, s2.pz);
  _p3.set(s3.px, s3.py, s3.pz);

  (_curve.points[0] as THREE.Vector3).copy(_p0);
  (_curve.points[1] as THREE.Vector3).copy(_p1);
  (_curve.points[2] as THREE.Vector3).copy(_p2);
  (_curve.points[3] as THREE.Vector3).copy(_p3);

  const pos = _curve.getPoint(frac);
  out.px = pos.x;
  out.py = pos.y;
  out.pz = pos.z;

  _quatA.set(s1.qx, s1.qy, s1.qz, s1.qw);
  _quatB.set(s2.qx, s2.qy, s2.qz, s2.qw);
  _quatA.slerp(_quatB, frac);
  out.qx = _quatA.x;
  out.qy = _quatA.y;
  out.qz = _quatA.z;
  out.qw = _quatA.w;

  return out;
}

export function getGhostDurationSec(ghost: DecodedGhost): number {
  if (ghost.sampleCount <= 1) return 0;
  return (ghost.sampleCount - 1) / GHOST_SAMPLE_HZ;
}
