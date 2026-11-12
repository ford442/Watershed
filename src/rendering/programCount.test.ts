import { describe, expect, it } from 'vitest';
import { liveProgramCount, liveProgramLabel, liveProgramList } from './programCount';

describe('liveProgramList (#555 A.3)', () => {
  it('reads WebGLRenderer.info.programs as is', () => {
    const programs = [{ name: 'MeshStandardMaterial', cacheKey: 'a' }, { name: 'ShaderMaterial', cacheKey: 'b' }];
    const gl = { info: { programs } };
    expect(liveProgramList(gl)).toBe(programs);
    expect(liveProgramCount(gl)).toBe(2);
  });

  it('reads the node renderer pipeline cache, entry by entry, so two reads diff by identity', () => {
    const p1 = { cacheKey: 'k1', vertexProgram: { name: 'vs' }, fragmentProgram: { name: 'fs' } };
    const p2 = { cacheKey: 'k2', computeProgram: { name: 'cs' } };
    const caches = new Map<string, object>([['k1', p1]]);
    const node = { isWebGPURenderer: true, info: { memory: { programs: 9 } }, _pipelines: { caches } };
    const before = new Set(liveProgramList(node));
    caches.set('k2', p2);
    const fresh = (liveProgramList(node) ?? []).filter((p) => !before.has(p));
    expect(liveProgramCount(node)).toBe(2);
    expect(fresh).toEqual([p2]);
    expect(liveProgramLabel(p1)).toBe('vs+fs');
    expect(liveProgramLabel(p2)).toBe('cs');
  });

  it('is null, not zero, where nothing is listed (node renderer before init, unknown shapes)', () => {
    expect(liveProgramCount({ isWebGPURenderer: true, _pipelines: null })).toBeNull();
    expect(liveProgramCount({ isWebGPURenderer: true })).toBeNull();
    expect(liveProgramCount({ info: {} })).toBeNull();
    expect(liveProgramCount(null)).toBeNull();
  });

  it('labels a program by name, else by the head of its key', () => {
    expect(liveProgramLabel({ name: 'Water' })).toBe('Water');
    expect(liveProgramLabel({ cacheKey: 'x'.repeat(80) })).toBe('x'.repeat(48));
    expect(liveProgramLabel({})).toBe('?');
  });
});
