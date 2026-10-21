/**
 * erosion — the canyon floor the river has worked (#487 E).
 *
 * Each segment carries an erosion plane E on its hull grid: one value per
 * collision-tile vertex, the same lattice the Rapier trimesh and the SWE bed
 * are built from. The floor every consumer sees is
 *
 *     h_eff = h − k·E,   k·E clamped to ±EROSION_MAX_DEPTH
 *
 * so a positive E is scour (the floor drops) and a negative E is a bar (it
 * rises). Three consumers, one offset:
 *
 *   - the trimesh and the bed add it at their own vertices, exactly;
 *   - the visual floor (4× finer) interpolates it over the hull's own
 *     triangles in grid coordinates — the split bathymetrySampler uses — so
 *     at every hull vertex the three agree to float rounding.
 *
 * Where E comes from: the SWE field's shear. Each solver step, every hull
 * vertex inside the window samples depth d and speed |u| and integrates
 *
 *     dE/dt = EROSION_RATE · max(0, q − q_c) − EROSION_DEPOSIT_RATE · deposit(q),   q = |u|·d
 *
 * Fast water above the critical flux scours; water that has slowed below it
 * drops what it carries (deposit peaks at q_c / 2 and is zero in still water,
 * which has nothing to drop). The SWE field is the river's departure from its
 * nominal flow, so a calm day leaves the bed alone and a storm or a dam
 * release works it: the fast outside of a bend digs, the slack inside builds.
 *
 * Pure: planes and buffers in, numbers out. No three.js, no React.
 */
import { bilinear, SWE_DRY_DEPTH } from '../systems/water/sampleSWEFlow';
import { computeVertexNormals } from './meshMath';
import type { GeometryBuffers, SegmentBedGrid, SegmentMeshBuffers } from './segmentMeshBuild';

/** Largest floor change either way (m). */
export const EROSION_MAX_DEPTH = 0.4;
/** h_eff = h − EROSION_K · E. */
export const EROSION_K = 1;
/** Unit-width discharge |u|·d (m²/s) above which the flow scours. */
export const EROSION_CRITICAL_FLUX = 0.12;
/** Scour per unit excess flux (1/m): m/s of floor per m²/s above q_c. */
export const EROSION_RATE = 0.005;
/** Deposition rate (1/m) of water that has slowed below q_c. */
export const EROSION_DEPOSIT_RATE = 0.0025;
/** A segment re-meshes at most this often (sim seconds)… */
export const EROSION_REFRESH_SECONDS = 3;
/** …and only once some vertex has moved this far (m) since its last mesh. */
export const EROSION_REFRESH_MIN_DELTA = 0.01;

const E_LIMIT = EROSION_MAX_DEPTH / EROSION_K;

/** The floor offset (m, added to h) an erosion value stands for. */
export function erosionOffset(e: number): number {
  const off = -EROSION_K * e;
  return off > EROSION_MAX_DEPTH ? EROSION_MAX_DEPTH : off < -EROSION_MAX_DEPTH ? -EROSION_MAX_DEPTH : off;
}

/** Vertices of a bed grid: one erosion value each. */
export function erosionPlaneSize(bed: Pick<SegmentBedGrid, 'segmentsX' | 'segmentsZ'>): number {
  return (bed.segmentsX + 1) * (bed.segmentsZ + 1);
}

/** The SWE field as erosion reads it (any backend's h / u / w / b mirror). */
export interface ErosionFieldView {
  /** Free-surface perturbation η (swe.h). */
  h: ArrayLike<number>;
  u: ArrayLike<number>;
  w: ArrayLike<number>;
  b: ArrayLike<number>;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  /** Still-water depth over a zero bed (SWE_MEAN_DEPTH). */
  stillDepth: number;
}

/** dE/dt (m/s) for unit-width discharge `q`. */
export function erosionRate(q: number): number {
  if (q >= EROSION_CRITICAL_FLUX) return EROSION_RATE * (q - EROSION_CRITICAL_FLUX);
  // Slowed water drops its load: zero when still, most at q_c / 2.
  const slack = EROSION_CRITICAL_FLUX - q;
  return -EROSION_DEPOSIT_RATE * slack * Math.min(1, q / EROSION_CRITICAL_FLUX);
}

/**
 * Integrate one solver step of `dt` into `plane` (hull-grid layout) from the
 * field under the segment. Vertices outside the window or on dry cells are
 * left alone. Returns the largest |ΔE| written.
 */
export function accumulateErosion(
  plane: Float32Array,
  bed: SegmentBedGrid,
  field: ErosionFieldView,
  dt: number,
): number {
  if (!(dt > 0)) return 0;
  const { segmentsX, segmentsZ, width, rows } = bed;
  const cols = segmentsX + 1;
  const cellX = width / segmentsX;
  const half = width / 2;
  const { cellSize, originX, originZ, stillDepth } = field;
  const maxGx = field.width - 1;
  const maxGz = field.height - 1;
  let moved = 0;
  for (let iz = 0; iz <= segmentsZ; iz += 1) {
    const gz = (rows[iz * 3 + 2] - originZ) / cellSize;
    if (!(gz >= 0 && gz <= maxGz)) continue;
    const rowX = rows[iz * 3] - half;
    for (let ix = 0; ix < cols; ix += 1) {
      const gx = (rowX + ix * cellX - originX) / cellSize;
      if (!(gx >= 0 && gx <= maxGx)) continue;
      const depth = stillDepth + bilinear(field.h, field.width, field.height, gx, gz)
        - bilinear(field.b, field.width, field.height, gx, gz);
      if (!(depth > SWE_DRY_DEPTH)) continue;
      const speed = Math.hypot(
        bilinear(field.u, field.width, field.height, gx, gz),
        bilinear(field.w, field.width, field.height, gx, gz),
      );
      const i = iz * cols + ix;
      const before = plane[i];
      const next = Math.max(-E_LIMIT, Math.min(E_LIMIT, before + erosionRate(speed * depth) * dt));
      if (!Number.isFinite(next)) continue;
      plane[i] = next;
      moved = Math.max(moved, Math.abs(next - before));
    }
  }
  return moved;
}

/**
 * Floor offset at hull-grid coordinates (gx ∈ [0, segmentsX], gz ∈ [0, segmentsZ]),
 * interpolated over the hull's triangles (a, b, d) / (b, c, d) — the split the
 * trimesh and bathymetrySampler use — so it is exact at every hull vertex.
 */
export function erosionOffsetAtGrid(
  plane: Float32Array,
  segmentsX: number,
  segmentsZ: number,
  gx: number,
  gz: number,
): number {
  const cols = segmentsX + 1;
  const ix = Math.max(0, Math.min(segmentsX - 1, Math.floor(gx)));
  const iz = Math.max(0, Math.min(segmentsZ - 1, Math.floor(gz)));
  const fx = Math.max(0, Math.min(1, gx - ix));
  const fz = Math.max(0, Math.min(1, gz - iz));
  const oa = erosionOffset(plane[iz * cols + ix]);
  const od = erosionOffset(plane[iz * cols + ix + 1]);
  const ob = erosionOffset(plane[(iz + 1) * cols + ix]);
  const oc = erosionOffset(plane[(iz + 1) * cols + ix + 1]);
  return fx + fz <= 1
    ? oa + (od - oa) * fx + (ob - oa) * fz
    : oc + (ob - oc) * (1 - fx) + (od - oc) * (1 - fz);
}

/** Largest |E| difference between two planes. */
export function erosionPlaneDelta(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i] - (b[i] ?? 0)));
  return max;
}

/** True when every value is zero (nothing to apply or store). */
export function erosionPlaneIsZero(plane: Float32Array): boolean {
  for (let i = 0; i < plane.length; i += 1) if (plane[i] !== 0) return false;
  return true;
}

/** `buffers` with `offsetOf(vertex)` added to every y, normals recomputed. */
function offsetY(buffers: GeometryBuffers, offsetOf: (vertex: number) => number): GeometryBuffers {
  const source = buffers.attributes.position.array;
  const positions = source.slice();
  const count = positions.length / 3;
  for (let i = 0; i < count; i += 1) positions[i * 3 + 1] += offsetOf(i);
  const attributes: GeometryBuffers['attributes'] = {
    ...buffers.attributes,
    position: { array: positions, itemSize: 3 },
  };
  const normal = buffers.attributes.normal;
  if (normal && buffers.index) {
    const normals = new Float32Array(normal.array.length);
    computeVertexNormals(positions, buffers.index, normals);
    attributes.normal = { array: normals, itemSize: 3 };
  }
  return { attributes, index: buffers.index };
}

/**
 * A segment's meshes on its eroded floor: the hull and the bed take the plane
 * at their own vertices; the visual floor (any density on the same extent)
 * takes it through `erosionOffsetAtGrid`. `base` is never modified — it is the
 * floor as built, and every refresh erodes it afresh. The wall shell and the
 * water sheet do not move.
 */
export function erodeSegmentMeshes(
  base: SegmentMeshBuffers,
  plane: Float32Array,
  visualSegmentsX: number,
): SegmentMeshBuffers {
  const bed = base.bed;
  if (!bed || plane.length !== erosionPlaneSize(bed) || erosionPlaneIsZero(plane)) return base;
  const { segmentsX, segmentsZ } = bed;

  const h = bed.h.slice();
  for (let i = 0; i < h.length; i += 1) h[i] += erosionOffset(plane[i]);

  const collision = base.collision ? offsetY(base.collision, (i) => erosionOffset(plane[i])) : null;

  let canyon = base.canyon;
  if (canyon) {
    const vCols = visualSegmentsX + 1;
    const vRows = canyon.attributes.position.array.length / 3 / vCols;
    const vSegmentsZ = vRows - 1;
    if (Number.isInteger(vRows) && vSegmentsZ >= 1) {
      canyon = offsetY(canyon, (i) => {
        const ix = i % vCols;
        const iz = (i - ix) / vCols;
        return erosionOffsetAtGrid(plane, segmentsX, segmentsZ, (ix / visualSegmentsX) * segmentsX, (iz / vSegmentsZ) * segmentsZ);
      });
    }
  }

  return { ...base, canyon, collision, bed: { ...bed, h } };
}
