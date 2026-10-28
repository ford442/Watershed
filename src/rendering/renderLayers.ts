/**
 * renderLayers — the scene's Object3D layer assignments.
 *
 * Layer 0 is everything. Water surfaces live on their own layer so the planar
 * reflection can leave them out of its render by camera mask instead of a
 * per-frame `scene.traverse` that toggles `visible` (WaterReflection.tsx). The
 * main camera enables the layer (FlowingWater does it on mount), so every pass
 * that renders with it — scene pass, SSAO normals, node post — still sees water.
 */

export const WATER_SURFACE_LAYER = 1;
