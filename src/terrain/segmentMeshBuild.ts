/**
 * segmentMeshBuild — a treadmill segment's meshes as plain buffers (#487 Phase B).
 *
 * The canyon, collision, wall-shell and water geometry used to be built in
 * TrackSegment's render on the main thread. A `SegmentMeshSpec` is everything
 * those builders read, as structured-clone data (the path as its control
 * points, not a CatmullRomCurve3), so the sim worker can run the same builders
 * on its WASM tile and post the attribute arrays back as transferables. The
 * main thread only wraps them in BufferGeometry.
 *
 * The main-thread fallback (no sim worker, boot and restart pools) calls the
 * builders directly on the TS mirror; both paths go through
 * `buildSegmentMeshBuffers`, so the geometry differs only by the tile's
 * mirror-vs-native rounding (≤ 1e-5, terrainParity.test.ts).
 */
import * as THREE from 'three';
import {
  buildCanyonGeometry,
  buildCollisionGeometry,
  buildWallShellGeometry,
  buildWaterGeometry,
  type GeometryBuildContext,
  type TerrainBuilders,
} from '../components/TrackSegment/hooks/geometryBuilders';
import type { ChannelProfileSample } from '../components/TrackSegment/types';
import type { TrackBiomeProfile } from '../configs/TrackBiomes';
import type { TubeProfile } from './terrainTile';

/** A CatmullRomCurve3 as data. */
export interface SegmentPathSpec {
  /** x, y, z per control point. */
  points: number[];
  closed: boolean;
  curveType: 'centripetal' | 'chordal' | 'catmullrom';
  tension: number;
}

/** Everything the segment builders read (GeometryBuildContext minus the curve object). */
export interface SegmentMeshSpec {
  segmentId: number;
  path: SegmentPathSpec;
  canyonWidth: number;
  waterWidth: number;
  biome: string;
  channelProfile: ChannelProfileSample[];
  isSlotCanyon: boolean;
  isGlacier: boolean;
  biomeProfile: Pick<TrackBiomeProfile, 'id' | 'wallHeight'>;
  tubeProfile: TubeProfile | null;
}

/** One BufferGeometry's arrays. */
export interface GeometryBuffers {
  attributes: Record<string, { array: Float32Array; itemSize: number }>;
  index: Uint16Array | Uint32Array | null;
}

/** A segment's four meshes; null where the builder rejected its input. */
export interface SegmentMeshBuffers {
  canyon: GeometryBuffers | null;
  collision: GeometryBuffers | null;
  wallShell: GeometryBuffers | null;
  water: GeometryBuffers | null;
}

export function segmentPathSpec(curve: THREE.CatmullRomCurve3): SegmentPathSpec {
  return {
    points: curve.points.flatMap((p) => [p.x, p.y, p.z]),
    closed: curve.closed,
    curveType: curve.curveType as SegmentPathSpec['curveType'],
    tension: curve.tension,
  };
}

export function curveFromSpec(spec: SegmentPathSpec): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < spec.points.length; i += 3) {
    points.push(new THREE.Vector3(spec.points[i], spec.points[i + 1], spec.points[i + 2]));
  }
  return new THREE.CatmullRomCurve3(points, spec.closed, spec.curveType, spec.tension);
}

export function segmentMeshSpec(ctx: GeometryBuildContext): SegmentMeshSpec {
  return {
    segmentId: ctx.segmentId,
    path: segmentPathSpec(ctx.segmentPath),
    canyonWidth: ctx.canyonWidth,
    waterWidth: ctx.waterWidth,
    biome: String(ctx.biome),
    // Plain objects: the samples are already data, this just drops readonly.
    channelProfile: ctx.channelProfile.map((sample) => ({ ...sample })),
    isSlotCanyon: ctx.isSlotCanyon,
    isGlacier: ctx.isGlacier,
    biomeProfile: { id: ctx.biomeProfile.id, wallHeight: ctx.biomeProfile.wallHeight },
    tubeProfile: ctx.tubeProfile ? { ...ctx.tubeProfile } : null,
  };
}

export function contextFromSpec(spec: SegmentMeshSpec, terrain?: TerrainBuilders): GeometryBuildContext {
  return {
    segmentPath: curveFromSpec(spec.path),
    segmentId: spec.segmentId,
    canyonWidth: spec.canyonWidth,
    waterWidth: spec.waterWidth,
    biome: spec.biome,
    channelProfile: spec.channelProfile,
    isSlotCanyon: spec.isSlotCanyon,
    isGlacier: spec.isGlacier,
    biomeProfile: spec.biomeProfile,
    tubeProfile: spec.tubeProfile,
    terrain,
  };
}

function toBuffers(geometry: THREE.BufferGeometry | null): GeometryBuffers | null {
  if (!geometry) return null;
  const attributes: GeometryBuffers['attributes'] = {};
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!(attribute instanceof THREE.BufferAttribute) || !(attribute.array instanceof Float32Array)) continue;
    attributes[name] = { array: attribute.array, itemSize: attribute.itemSize };
  }
  const index = geometry.index?.array;
  const buffers = {
    attributes,
    index: index instanceof Uint16Array || index instanceof Uint32Array ? index : null,
  };
  geometry.dispose();
  return buffers;
}

/** Build all four meshes of a segment into buffers. */
export function buildSegmentMeshBuffers(ctx: GeometryBuildContext): SegmentMeshBuffers {
  return {
    canyon: toBuffers(buildCanyonGeometry(ctx)),
    collision: toBuffers(buildCollisionGeometry(ctx)),
    wallShell: toBuffers(buildWallShellGeometry(ctx)),
    water: toBuffers(buildWaterGeometry(ctx)),
  };
}

/** Every array buffer in `meshes`, for postMessage's transfer list. */
export function segmentMeshTransferables(meshes: SegmentMeshBuffers): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const mesh of [meshes.canyon, meshes.collision, meshes.wallShell, meshes.water]) {
    if (!mesh) continue;
    for (const { array } of Object.values(mesh.attributes)) out.add(array.buffer as ArrayBuffer);
    if (mesh.index) out.add(mesh.index.buffer as ArrayBuffer);
  }
  return [...out];
}

/** Wrap buffers in a BufferGeometry (no copy). */
export function geometryFromBuffers(buffers: GeometryBuffers | null): THREE.BufferGeometry | null {
  if (!buffers) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, { array, itemSize }] of Object.entries(buffers.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  if (buffers.index) geometry.setIndex(new THREE.BufferAttribute(buffers.index, 1));
  return geometry;
}
