/**
 * Frame helpers for placement — three-free ports of the three.js maths the
 * legacy placement used (#487 D; split out of `terrain/placement.ts` in #559 C).
 */

import type { SegmentPath } from '../segmentMeshBuild';
import type { Vec3 } from '../meshMath';

/** three's Curve.getTangent: a ±1e-4 central difference, normalised. */
export function pathTangent(path: Pick<SegmentPath, 'getPoint'>, t: number): Vec3 {
  const delta = 0.0001;
  const p1 = path.getPoint(Math.max(0, t - delta));
  const p2 = path.getPoint(Math.min(1, t + delta));
  const x = p2.x - p1.x;
  const y = p2.y - p1.y;
  const z = p2.z - p1.z;
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/** XYZ Euler of the rotation taking +Y onto `to` (three's setFromUnitVectors → setFromQuaternion). */
export function eulerFromUp(to: Vec3): Vec3 {
  // q = (up × to, 1 + up·to), normalised.
  let qx = to.z;
  let qy = 0;
  let qz = -to.x;
  let qw = 1 + to.y;
  const ql = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= ql;
  qy /= ql;
  qz /= ql;
  qw /= ql;
  const m11 = 1 - 2 * (qy * qy + qz * qz);
  const m12 = 2 * (qx * qy - qw * qz);
  const m13 = 2 * (qx * qz + qw * qy);
  const m22 = 1 - 2 * (qx * qx + qz * qz);
  const m23 = 2 * (qy * qz - qw * qx);
  const m32 = 2 * (qy * qz + qw * qx);
  const m33 = 1 - 2 * (qx * qx + qy * qy);
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return { x: Math.atan2(-m23, m33), y, z: Math.atan2(-m12, m11) };
  return { x: Math.atan2(m32, m22), y, z: 0 };
}

export const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};
