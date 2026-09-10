/**
 * physicsColliderRegistry.ts — tracks triangle counts of currently-mounted
 * track-segment trimesh colliders, keyed by segment id.
 *
 * TrackSegmentCollisionMeshes registers/unregisters its collisionGeometry's
 * triangle count on mount/unmount; PhysicsPerfMonitor sums the live total
 * into physicsPerfMetrics so the profiling baseline can report collider
 * cost alongside world.step() timing.
 */

const _triangleCounts = new Map<number, number>();

export function registerCollisionTriangles(segmentId: number, triangleCount: number): void {
  _triangleCounts.set(segmentId, triangleCount);
}

export function unregisterCollisionTriangles(segmentId: number): void {
  _triangleCounts.delete(segmentId);
}

export function getTotalActiveCollisionTriangles(): number {
  let total = 0;
  for (const count of _triangleCounts.values()) total += count;
  return total;
}
