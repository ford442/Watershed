/**
 * nodeMaterials.ts — lazy loader for every TSL/NodeMaterial module.
 *
 * WHY THIS EXISTS: `three/webgpu` is ~800 kB. A static import of it anywhere in
 * the render graph drags the whole WebGPU bundle into the main chunk, which every
 * player pays for even though the default backend is GLSL. So the node materials
 * are imported dynamically, and the material hosts read them through this cache.
 *
 * ORDERING: `createGameRenderer` awaits `loadNodeMaterials()` while building the
 * node renderer, which happens in the Canvas `gl` callback — strictly before any
 * material is constructed inside the scene. By the time FlowingWater or
 * TrackSegment ask for a TSL material, the module is resolved and the hosts can
 * stay synchronous. If it somehow isn't, the hosts fall back to GLSL rather than
 * blocking a frame.
 */

export type WaterNodeModule = typeof import('./water/WaterNodeMaterial');
export type RiverNodeModule = typeof import('./RiverNodeMaterial');
export type CanyonNodeModule = typeof import('./CanyonNodeMaterial');

export interface NodeMaterialModules {
  water: WaterNodeModule;
  river: RiverNodeModule;
  canyon: CanyonNodeModule;
}

let cached: NodeMaterialModules | null = null;
let pending: Promise<NodeMaterialModules> | null = null;

/** Load (or return the cached) node-material modules. Safe to call repeatedly. */
export function loadNodeMaterials(): Promise<NodeMaterialModules> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = Promise.all([
    import('./water/WaterNodeMaterial'),
    import('./RiverNodeMaterial'),
    import('./CanyonNodeMaterial'),
  ]).then(([water, river, canyon]) => {
    cached = { water, river, canyon };
    pending = null;
    return cached;
  });

  return pending;
}

/** Synchronous accessor — null until `loadNodeMaterials()` has resolved. */
export function getLoadedNodeMaterials(): NodeMaterialModules | null {
  return cached;
}

/** Test seam — drops the cache so a test can assert the not-yet-loaded path. */
export function resetNodeMaterialsCache(): void {
  cached = null;
  pending = null;
}
