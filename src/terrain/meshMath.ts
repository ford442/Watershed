/**
 * meshMath — the slice of three.js the segment mesh builders use, without three (#487 Phase B).
 *
 * The builders run in the sim worker, and three's core is ~110 kB of worker
 * chunk for a curve, a colour and a plane. These are line-for-line ports of
 * three 0.185 (`CatmullRomCurve3` + `Curve.getLengths`, `Color.setHex` +
 * `SRGBToLinear`, `PlaneGeometry` after `rotateX(−π/2)`,
 * `BufferGeometry.computeVertexNormals`; `MathUtils.clamp` / `smoothstep` are
 * `src/math/scalar.ts`)
 * with the same operation order and the same float32 stores, so a mesh built
 * here is bit-identical to the three-built one (`meshMath.test.ts` pins each
 * against three itself).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Colour (linear-sRGB working space, as THREE.Color with ColorManagement on)
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** ColorManagement's SRGBToLinear. */
function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** `new THREE.Color('#rrggbb')`: sRGB hex into the linear working space. */
export function rgb(hex: string): Rgb {
  const match = /^#([A-Fa-f\d]{6})$/.exec(hex);
  if (!match) throw new Error(`rgb: expected #rrggbb, got ${hex}`);
  const value = Math.floor(parseInt(match[1], 16));
  return {
    r: srgbToLinear(((value >> 16) & 255) / 255),
    g: srgbToLinear(((value >> 8) & 255) / 255),
    b: srgbToLinear((value & 255) / 255),
  };
}

/** Color.copy */
export function copyRgb(out: Rgb, c: Rgb): Rgb {
  out.r = c.r;
  out.g = c.g;
  out.b = c.b;
  return out;
}

/** Color.lerp */
export function lerpRgb(out: Rgb, to: Rgb, alpha: number): Rgb {
  out.r += (to.r - out.r) * alpha;
  out.g += (to.g - out.g) * alpha;
  out.b += (to.b - out.b) * alpha;
  return out;
}

/** Color.multiplyScalar */
export function scaleRgb(out: Rgb, s: number): Rgb {
  out.r *= s;
  out.g *= s;
  out.b *= s;
  return out;
}

// ---------------------------------------------------------------------------
// CatmullRomCurve3
// ---------------------------------------------------------------------------

export type CurveType = 'centripetal' | 'chordal' | 'catmullrom';

/** CubicPoly from CatmullRomCurve3.js. */
class CubicPoly {
  private c0 = 0;
  private c1 = 0;
  private c2 = 0;
  private c3 = 0;

  private init(x0: number, x1: number, t0: number, t1: number): void {
    this.c0 = x0;
    this.c1 = t0;
    this.c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
    this.c3 = 2 * x0 - 2 * x1 + t0 + t1;
  }

  initCatmullRom(x0: number, x1: number, x2: number, x3: number, tension: number): void {
    this.init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
  }

  initNonuniformCatmullRom(x0: number, x1: number, x2: number, x3: number, dt0: number, dt1: number, dt2: number): void {
    let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
    let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
    t1 *= dt1;
    t2 *= dt1;
    this.init(x1, x2, t1, t2);
  }

  calc(t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return this.c0 + this.c1 * t + this.c2 * t2 + this.c3 * t3;
  }
}

const distanceToSquared = (a: Vec3, b: Vec3) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

/** Curve.arcLengthDivisions */
const ARC_LENGTH_DIVISIONS = 200;

/** CatmullRomCurve3: `getPoint(t)` and `getLength()`, nothing else. */
export class CatmullRomPath {
  private readonly px = new CubicPoly();
  private readonly py = new CubicPoly();
  private readonly pz = new CubicPoly();
  private length: number | null = null;

  constructor(
    readonly points: readonly Vec3[],
    readonly closed = false,
    readonly curveType: CurveType = 'centripetal',
    readonly tension = 0.5,
  ) {}

  getPoint(t: number): Vec3 {
    const points = this.points;
    const l = points.length;

    const p = (l - (this.closed ? 0 : 1)) * t;
    let intPoint = Math.floor(p);
    let weight = p - intPoint;

    if (this.closed) {
      intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
    } else if (weight === 0 && intPoint === l - 1) {
      intPoint = l - 2;
      weight = 1;
    }

    let p0: Vec3;
    let p3: Vec3;
    if (this.closed || intPoint > 0) {
      p0 = points[(intPoint - 1) % l];
    } else {
      // extrapolate first point: (p[0] − p[1]) + p[0]
      p0 = {
        x: points[0].x - points[1].x + points[0].x,
        y: points[0].y - points[1].y + points[0].y,
        z: points[0].z - points[1].z + points[0].z,
      };
    }

    const p1 = points[intPoint % l];
    const p2 = points[(intPoint + 1) % l];

    if (this.closed || intPoint + 2 < l) {
      p3 = points[(intPoint + 2) % l];
    } else {
      // extrapolate last point: (p[l−1] − p[l−2]) + p[l−1]
      p3 = {
        x: points[l - 1].x - points[l - 2].x + points[l - 1].x,
        y: points[l - 1].y - points[l - 2].y + points[l - 1].y,
        z: points[l - 1].z - points[l - 2].z + points[l - 1].z,
      };
    }

    if (this.curveType === 'centripetal' || this.curveType === 'chordal') {
      const pow = this.curveType === 'chordal' ? 0.5 : 0.25;
      let dt0 = Math.pow(distanceToSquared(p0, p1), pow);
      let dt1 = Math.pow(distanceToSquared(p1, p2), pow);
      let dt2 = Math.pow(distanceToSquared(p2, p3), pow);
      if (dt1 < 1e-4) dt1 = 1.0;
      if (dt0 < 1e-4) dt0 = dt1;
      if (dt2 < 1e-4) dt2 = dt1;
      this.px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
      this.py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
      this.pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
    } else {
      this.px.initCatmullRom(p0.x, p1.x, p2.x, p3.x, this.tension);
      this.py.initCatmullRom(p0.y, p1.y, p2.y, p3.y, this.tension);
      this.pz.initCatmullRom(p0.z, p1.z, p2.z, p3.z, this.tension);
    }

    return { x: this.px.calc(weight), y: this.py.calc(weight), z: this.pz.calc(weight) };
  }

  /** Curve.getLength (arcLengthDivisions = 200). */
  getLength(): number {
    if (this.length === null) {
      let last = this.getPoint(0);
      let sum = 0;
      for (let p = 1; p <= ARC_LENGTH_DIVISIONS; p += 1) {
        const current = this.getPoint(p / ARC_LENGTH_DIVISIONS);
        sum += Math.sqrt(distanceToSquared(current, last));
        last = current;
      }
      this.length = sum;
    }
    return this.length;
  }
}

// ---------------------------------------------------------------------------
// PlaneGeometry(width, height, segX, segY).rotateX(−π/2)
// ---------------------------------------------------------------------------

export interface PlaneGrid {
  /** xyz per vertex. After the rotation: x across, y ≈ 0, z along. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  index: Uint16Array | Uint32Array;
  count: number;
}

// Matrix4.makeRotationX(−π/2): the non-trivial elements.
const ROT_C = Math.cos(-Math.PI / 2);
const ROT_S = Math.sin(-Math.PI / 2);

export function planeGrid(width: number, height: number, widthSegments: number, heightSegments: number): PlaneGrid {
  const widthHalf = width / 2;
  const heightHalf = height / 2;
  const gridX = Math.floor(widthSegments);
  const gridY = Math.floor(heightSegments);
  const gridX1 = gridX + 1;
  const gridY1 = gridY + 1;
  const segmentWidth = width / gridX;
  const segmentHeight = height / gridY;
  const count = gridX1 * gridY1;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  // The rotated (0, 0, 1) normal, normalized (only survives on a NaN path —
  // every finite build recomputes normals).
  const ny = -ROT_S;
  const nz = ROT_C;
  const nLength = Math.sqrt(ny * ny + nz * nz) || 1;

  let v = 0;
  for (let iy = 0; iy < gridY1; iy += 1) {
    const y = iy * segmentHeight - heightHalf;
    for (let ix = 0; ix < gridX1; ix += 1) {
      const x = ix * segmentWidth - widthHalf;
      // PlaneGeometry stores (x, −y, 0) as float32; Vector3.applyMatrix4 then
      // rotates with w = 1 and stores float32 again.
      const px = Math.fround(x);
      const py = Math.fround(-y);
      const pz = 0;
      positions[v * 3] = 1 * px + 0 * py + 0 * pz + 0;
      positions[v * 3 + 1] = 0 * px + ROT_C * py + -ROT_S * pz + 0;
      positions[v * 3 + 2] = 0 * px + ROT_S * py + ROT_C * pz + 0;
      normals[v * 3] = 0;
      normals[v * 3 + 1] = ny * (1 / nLength);
      normals[v * 3 + 2] = nz * (1 / nLength);
      uvs[v * 2] = ix / gridX;
      uvs[v * 2 + 1] = 1 - iy / gridY;
      v += 1;
    }
  }

  const indexCount = gridX * gridY * 6;
  // setIndex: Uint32 once any index reaches 65535 (primitive restart).
  const index = count - 1 >= 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let k = 0;
  for (let iy = 0; iy < gridY; iy += 1) {
    for (let ix = 0; ix < gridX; ix += 1) {
      const a = ix + gridX1 * iy;
      const b = ix + gridX1 * (iy + 1);
      const c = ix + 1 + gridX1 * (iy + 1);
      const d = ix + 1 + gridX1 * iy;
      index[k++] = a;
      index[k++] = b;
      index[k++] = d;
      index[k++] = b;
      index[k++] = c;
      index[k++] = d;
    }
  }

  return { positions, normals, uvs, index, count };
}

// ---------------------------------------------------------------------------
// BufferGeometry.computeVertexNormals (indexed) + normalizeNormals
// ---------------------------------------------------------------------------

/** Area-weighted vertex normals into `normals` (zeroed first), float32 stores as three's. */
export function computeVertexNormals(
  positions: Float32Array,
  index: Uint16Array | Uint32Array,
  normals: Float32Array,
): void {
  normals.fill(0);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3;
    const b = index[i + 1] * 3;
    const c = index[i + 2] * 3;
    // cb = pC − pB, ab = pA − pB, cb × ab
    const cbx = positions[c] - positions[b];
    const cby = positions[c + 1] - positions[b + 1];
    const cbz = positions[c + 2] - positions[b + 2];
    const abx = positions[a] - positions[b];
    const aby = positions[a + 1] - positions[b + 1];
    const abz = positions[a + 2] - positions[b + 2];
    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;
    normals[a] += nx;
    normals[a + 1] += ny;
    normals[a + 2] += nz;
    normals[b] += nx;
    normals[b + 1] += ny;
    normals[b + 2] += nz;
    normals[c] += nx;
    normals[c + 1] += ny;
    normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    normals[i] = x * inv;
    normals[i + 1] = y * inv;
    normals[i + 2] = z * inv;
  }
}
