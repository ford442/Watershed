/** Moss height fade band above waterline (world-space meters). */
export const MOSS_HEIGHT_FADE = { low: 2.0, high: 4.5 } as const;

/** Moss normal mask — upward-facing surface dot-product thresholds. */
export const MOSS_NORMAL_MASK = { low: 0.15, high: 0.82 } as const;

/** CPU smoothstep mirror of the GLSL/TSL moss normal mask. */
export function mossNormalFactor(dotUp: number): number {
  const range = MOSS_NORMAL_MASK.high - MOSS_NORMAL_MASK.low;
  const t = (dotUp - MOSS_NORMAL_MASK.low) / range;
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Transform a local normal to world space (identity-scale meshes). */
export function worldNormalFromLocal(
  localNormal: [number, number, number],
  modelMatrixElements: number[]
): [number, number, number] {
  const [nx, ny, nz] = localNormal;
  const m = modelMatrixElements;
  const wx = m[0] * nx + m[4] * ny + m[8] * nz;
  const wy = m[1] * nx + m[5] * ny + m[9] * nz;
  const wz = m[2] * nx + m[6] * ny + m[10] * nz;
  const len = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
  return [wx / len, wy / len, wz / len];
}
