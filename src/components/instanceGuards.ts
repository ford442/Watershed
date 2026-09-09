/**
 * Decision rules behind the instancing guards, kept separate from the React
 * wrappers so they can be tested without mounting an R3F scene graph.
 *
 * Why they exist: three r168's node pipeline cannot compile a zero-count
 * InstancedMesh, and one such frame poisons that object's program permanently.
 * See [`useHideWhileEmpty`](../hooks/useHideWhileEmpty.ts).
 */

/** Instance capacity declared through an `<instancedMesh>` `args` tuple. */
export function instancedMeshCapacity(args: unknown): number {
  if (!Array.isArray(args)) return 0;
  const capacity = args[2];
  return typeof capacity === 'number' && Number.isFinite(capacity) ? capacity : 0;
}

/**
 * True when a drei `<Instances>` layer provably has nothing to draw.
 *
 * Deliberately conservative: `range`/`limit` are optional caps, so only an
 * explicit zero counts. A layer that sizes itself some other way still renders
 * and is caught by the per-frame guard instead.
 */
export function isProvablyEmptyLayer(layer: {
  childCount: number;
  range?: number;
  limit?: number;
}): boolean {
  return layer.childCount === 0 || layer.range === 0 || layer.limit === 0;
}
