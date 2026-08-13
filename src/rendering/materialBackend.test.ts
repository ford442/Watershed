import {
  isMaterialBackend,
  parseMaterialBackendParam,
  resolveMaterialBackend,
  type MaterialBackendEnvironment,
} from './materialBackend';

/** A browser that can host a node renderer, so only the flags under test vary. */
const capable = (over: Partial<MaterialBackendEnvironment> = {}): MaterialBackendEnvironment => ({
  search: '',
  stored: null,
  nodeRendererSupported: true,
  ...over,
});

describe('resolveMaterialBackend', () => {
  it('defaults to the legacy GLSL backend — production is unchanged', () => {
    expect(resolveMaterialBackend(capable())).toEqual({
      backend: 'glsl',
      reason: 'default-glsl',
    });
  });

  it('selects TSL for ?material=tsl', () => {
    expect(resolveMaterialBackend(capable({ search: '?material=tsl' }))).toEqual({
      backend: 'tsl',
      reason: 'query-tsl',
    });
  });

  it('lets ?material=glsl override a stored TSL preference', () => {
    expect(
      resolveMaterialBackend(capable({ search: '?material=glsl', stored: 'tsl' })),
    ).toEqual({ backend: 'glsl', reason: 'query-glsl' });
  });

  it('honours the stored debug-panel preference when no query param is set', () => {
    expect(resolveMaterialBackend(capable({ stored: 'tsl' }))).toEqual({
      backend: 'tsl',
      reason: 'stored-tsl',
    });
  });

  it('collapses any TSL request to GLSL when no node renderer can exist', () => {
    expect(
      resolveMaterialBackend(capable({ search: '?material=tsl', nodeRendererSupported: false })),
    ).toEqual({ backend: 'glsl', reason: 'unsupported' });
    expect(
      resolveMaterialBackend(capable({ stored: 'tsl', nodeRendererSupported: false })),
    ).toEqual({ backend: 'glsl', reason: 'unsupported' });
  });

  it('ignores an unrecognised ?material value', () => {
    expect(resolveMaterialBackend(capable({ search: '?material=wgsl' })).backend).toBe('glsl');
  });

  it('accepts a query string with or without the leading ?', () => {
    expect(resolveMaterialBackend(capable({ search: 'material=tsl' })).backend).toBe('tsl');
  });
});

describe('parseMaterialBackendParam', () => {
  it('returns null when the parameter is absent or invalid', () => {
    expect(parseMaterialBackendParam('')).toBeNull();
    expect(parseMaterialBackendParam('?material=')).toBeNull();
    expect(parseMaterialBackendParam('?material=metal')).toBeNull();
  });

  it('reads both valid values', () => {
    expect(parseMaterialBackendParam('?material=tsl')).toBe('tsl');
    expect(parseMaterialBackendParam('?material=glsl')).toBe('glsl');
  });
});

describe('isMaterialBackend', () => {
  it('narrows only the two known backends', () => {
    expect(isMaterialBackend('glsl')).toBe(true);
    expect(isMaterialBackend('tsl')).toBe(true);
    expect(isMaterialBackend('webgpu')).toBe(false);
    expect(isMaterialBackend(null)).toBe(false);
  });
});
