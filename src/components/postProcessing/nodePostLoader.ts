/**
 * nodePostLoader — lazy loader for the node post pipeline (epic #434 B2).
 *
 * Same contract as `loadNodeMaterials()`: `three/webgpu` stays out of the main
 * chunk, and `createGameRenderer` awaits this while building the node renderer,
 * so `PostProcessingPipeline` can read the module synchronously on mount.
 */

export type NodePostModule = typeof import('./nodePostPipeline');

let cached: NodePostModule | null = null;
let pending: Promise<NodePostModule> | null = null;

/** Load (or return the cached) node post module. Safe to call repeatedly. */
export function loadNodePost(): Promise<NodePostModule> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = import('./nodePostPipeline').then((mod) => {
    cached = mod;
    pending = null;
    return mod;
  });
  return pending;
}

/** Synchronous accessor — null until `loadNodePost()` has resolved. */
export function getLoadedNodePost(): NodePostModule | null {
  return cached;
}

/** Test seam — drops the cache so a test can assert the not-yet-loaded path. */
export function resetNodePostCache(): void {
  cached = null;
  pending = null;
}
