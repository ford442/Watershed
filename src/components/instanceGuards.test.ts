/**
 * three r168's node pipeline cannot compile a zero-count InstancedMesh — it
 * emits an unsized `mat4 bufferN[]` inside a uniform block — and one such frame
 * poisons that object's program permanently. These are the rules that keep an
 * empty layer away from the renderer; the wrappers around them are thin.
 */

import { instancedMeshCapacity, isProvablyEmptyLayer } from './instanceGuards';
import { resolveInstancedVisibility } from '../hooks/useHideWhileEmpty';

describe('instancedMeshCapacity', () => {
  it('reads the capacity out of an args tuple', () => {
    expect(instancedMeshCapacity([null, null, 12])).toBe(12);
    expect(instancedMeshCapacity([null, null, 0])).toBe(0);
  });

  it('reads a missing or malformed tuple as empty rather than mounting blind', () => {
    expect(instancedMeshCapacity(undefined)).toBe(0);
    expect(instancedMeshCapacity([null, null])).toBe(0);
    expect(instancedMeshCapacity([null, null, NaN])).toBe(0);
  });
});

describe('isProvablyEmptyLayer', () => {
  it('drops a layer with no children', () => {
    expect(isProvablyEmptyLayer({ childCount: 0 })).toBe(true);
  });

  it('drops a layer that range or limit sizes to zero', () => {
    expect(isProvablyEmptyLayer({ childCount: 3, range: 0 })).toBe(true);
    expect(isProvablyEmptyLayer({ childCount: 3, limit: 0 })).toBe(true);
  });

  it('stays conservative — an unsized layer with children still renders', () => {
    expect(isProvablyEmptyLayer({ childCount: 1 })).toBe(false);
    expect(isProvablyEmptyLayer({ childCount: 2, range: 2, limit: 1000 })).toBe(false);
  });
});

describe('resolveInstancedVisibility', () => {
  it('hides an empty mesh and shows a populated one', () => {
    expect(resolveInstancedVisibility(0, true)).toBe(false);
    expect(resolveInstancedVisibility(1, true)).toBe(true);
  });

  it('never overrides a caller that asked for the mesh to stay hidden', () => {
    expect(resolveInstancedVisibility(50, false)).toBe(false);
  });
});
