/**
 * segmentWorld.ts — what the treadmill's React tree does with a segment, as plain calls (#556 B.1).
 *
 * In the page a mounted `<TrackSegment>` builds its meshes (useGeometries →
 * segmentMeshBuild), mounts the hull as a fixed trimesh body
 * (TrackSegmentCollisionMeshes), publishes the same hull grid as the SWE bed
 * (bathymetrySampler) and registers its erosion plane (erosionField). Here the
 * same builders and the same registries are driven directly, over a Rapier
 * world with no three scene: the physics and the field a headless step sees are
 * the page's.
 *
 * The prop derivations below (canyon / water width, channel profile, tube
 * profile, friction) are TrackSegment's, read for the same SegmentData. They are
 * a copy: TrackSegment is a component and a headless run cannot mount it. A
 * change to those derivations there must be made here too (the campaign
 * pin — headless.campaign.test.ts — fails when they drift).
 *
 * Not mounted here: decorations, pooled obstacles and their colliders, pillars,
 * water meshes. A run through the authored centreline touches none of them; a
 * pilot that drives into a rock will not collide with it headless.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { buildChannelProfile } from '../../components/TrackSegment/channelProfile';
import { resolveTubeProfile } from '../../components/TrackSegment/hooks/geometryBuilders';
import { isGlacialBiome, getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { normalizeBiomeId } from '../../configs/biomes';
import {
  buildSegmentMeshBuffers,
  CANYON_VISUAL_SEGMENTS_X,
  type GeometryBuildContext,
  type SegmentMeshBuffers,
} from '../../terrain/segmentMeshBuild';
import { erodeSegmentMeshes } from '../../terrain/erosion';
import type { SegmentData } from '../../systems/map/ChunkManager';
import {
  createSegmentBathymetrySource,
  registerSegmentBathymetry,
  unregisterSegmentBathymetry,
} from '../../systems/water/bathymetrySampler';
import {
  getSegmentErosion,
  getSegmentErosionVersion,
  registerSegmentErosion,
  unregisterSegmentErosion,
} from '../../systems/water/erosionField';
import { resolveSegmentFriction, resolveSegmentRestitution } from '../../systems/survival/surfaceFriction';

type Rapier = typeof RAPIER;

/** TrackSegment's derivation of the builders' context from a treadmill segment. */
export function segmentBuildContext(segment: SegmentData): GeometryBuildContext {
  const biomeId = normalizeBiomeId(segment.biome);
  const biomeProfile = getTrackBiomeProfile(biomeId);
  const isSlotCanyon = biomeProfile.id === 'slotCanyon';
  const canyonWidth = isSlotCanyon ? biomeProfile.canyonWidth : segment.width;
  const waterWidth =
    segment.waterWidth ?? (segment.type === 'pond' ? Math.max(45, biomeProfile.waterWidth) : biomeProfile.waterWidth);
  const isGlacier = isGlacialBiome(biomeId, biomeProfile);
  return {
    segmentPath: segment.segmentPath,
    segmentId: segment.id,
    canyonWidth,
    waterWidth,
    biome: biomeId,
    channelProfile: buildChannelProfile({
      segmentId: segment.id,
      pathLength: segment.segmentPath.getLength(),
      waterWidth,
      segmentType: segment.type,
      isSlotCanyon,
    }),
    isSlotCanyon,
    isGlacier,
    biomeProfile,
    tubeProfile: resolveTubeProfile({ isGlacier, biome: biomeId, type: segment.type, canyonWidth }),
    placement: null,
  };
}

interface Mounted {
  segment: SegmentData;
  /** Meshes as built (never eroded). */
  built: SegmentMeshBuffers;
  /** The erosion version the live hull was built from. */
  erosionVersion: number;
  slipperiness: number;
  body: RAPIER.RigidBody | null;
  poolFloor: RAPIER.RigidBody | null;
}

export class SegmentWorld {
  private readonly mounted = new Map<number, Mounted>();

  constructor(
    private readonly world: RAPIER.World,
    private readonly rapier: Rapier,
  ) {}

  /** True when `segment` (this very object) is the live occupant of its id. */
  has(segment: SegmentData): boolean {
    return this.mounted.get(segment.id)?.segment === segment;
  }

  /** Segment ids currently mounted. */
  ids(): number[] {
    return [...this.mounted.keys()];
  }

  /**
   * Mount a segment (replacing the id's previous occupant, as a recycled treadmill
   * slot does). `slipperiness` is the map config's plus the segment's own add.
   */
  mount(segment: SegmentData, slipperiness: number): void {
    this.unmount(segment.id);
    const built = buildSegmentMeshBuffers(segmentBuildContext(segment));
    const entry: Mounted = { segment, built, erosionVersion: 0, slipperiness, body: null, poolFloor: null };
    this.mounted.set(segment.id, entry);
    if (built.bed) registerSegmentErosion(segment.id, built.bed, null);
    this.publish(entry, built);
  }

  unmount(segmentId: number): void {
    const entry = this.mounted.get(segmentId);
    if (!entry) return;
    this.removeBodies(entry);
    unregisterSegmentBathymetry(segmentId);
    unregisterSegmentErosion(segmentId);
    this.mounted.delete(segmentId);
  }

  /**
   * The floor the river has worked: segments whose erosion version moved are
   * rebuilt from their uneroded meshes (hull, bed and collider together), as
   * useGeometries does when `useSyncExternalStore` hands it the new version.
   * Returns how many were rebuilt.
   */
  refreshErosion(): number {
    let rebuilt = 0;
    for (const entry of this.mounted.values()) {
      const version = getSegmentErosionVersion(entry.segment.id);
      if (version === entry.erosionVersion) continue;
      entry.erosionVersion = version;
      const erosion = getSegmentErosion(entry.segment.id);
      const meshes =
        !erosion || entry.built.bed !== erosion.bed || version === 0
          ? entry.built
          : erodeSegmentMeshes(entry.built, erosion.applied, CANYON_VISUAL_SEGMENTS_X);
      this.removeBodies(entry);
      this.publish(entry, meshes);
      rebuilt += 1;
    }
    return rebuilt;
  }

  dispose(): void {
    for (const id of this.ids()) this.unmount(id);
  }

  private removeBodies(entry: Mounted): void {
    if (entry.body) this.world.removeRigidBody(entry.body);
    if (entry.poolFloor) this.world.removeRigidBody(entry.poolFloor);
    entry.body = null;
    entry.poolFloor = null;
  }

  /** Bed + collider for `meshes` (the segment's live hull). */
  private publish(entry: Mounted, meshes: SegmentMeshBuffers): void {
    const { segment } = entry;
    const source = createSegmentBathymetrySource(segment.id, meshes.bed);
    if (source) registerSegmentBathymetry(segment.id, source);
    else unregisterSegmentBathymetry(segment.id);

    const openFloor = Boolean(segment.config?.openFloor) || Boolean(segment.config?.washedOutGap);
    const profile = getTrackBiomeProfile(normalizeBiomeId(segment.biome));
    const friction = resolveSegmentFriction({
      baseFriction: profile.wallFriction,
      slipperiness: entry.slipperiness,
      segmentState: segment.segmentState,
    });
    const restitution = resolveSegmentRestitution(profile.id === 'slotCanyon' ? 0.02 : 0.1, entry.slipperiness);

    const collision = meshes.collision;
    if (!openFloor && collision) {
      const { rapier, world } = this;
      const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
      const index = collision.index;
      if (index) {
        const desc = rapier.ColliderDesc.trimesh(
          collision.attributes.position.array,
          index instanceof Uint32Array ? index : Uint32Array.from(index),
        );
        const collider = world.createCollider(desc, body);
        collider.setFriction(friction);
        collider.setRestitution(restitution);
      }
      entry.body = body;
    }

    // The pool / splash safety box (absolute y = -8), as TrackSegmentCollisionMeshes mounts it.
    if (segment.type === 'splash' || segment.type === 'pond') {
      const canyon = meshes.canyon?.attributes.position.array;
      if (canyon) {
        const center = boundsCenter(canyon);
        const { rapier, world } = this;
        const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
        const desc = rapier.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(center.x, -8, center.z);
        const collider = world.createCollider(desc, body);
        collider.setFriction(0.9);
        collider.setRestitution(0.1);
        entry.poolFloor = body;
      }
    }
  }
}

function boundsCenter(positions: Float32Array): { x: number; z: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}
