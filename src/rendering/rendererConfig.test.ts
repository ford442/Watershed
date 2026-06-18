import {
  isRendererPreference,
  parseRendererPreference,
  syncRendererPreferenceToUrl,
} from './rendererConfig';

const STORAGE_KEY = 'watershed.renderer.preference';

describe('rendererConfig', () => {
  const originalUrl = window.location.href;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalUrl);
  });

  it('defaults to webgl when no URL or storage override exists', () => {
    expect(parseRendererPreference('')).toBe('webgl');
  });

  it('reads renderer preference from URL params', () => {
    expect(parseRendererPreference('?renderer=webgl')).toBe('webgl');
    expect(parseRendererPreference('?renderer=webgpu')).toBe('webgpu');
  });

  it('falls back to stored preference when URL param is absent', () => {
    window.localStorage.setItem(STORAGE_KEY, 'webgl');
    expect(parseRendererPreference('')).toBe('webgl');
  });

  it('prefers URL param over stored preference', () => {
    window.localStorage.setItem(STORAGE_KEY, 'webgl');
    expect(parseRendererPreference('?renderer=webgpu')).toBe('webgpu');
  });

  it('syncs renderer preference into the URL', () => {
    syncRendererPreferenceToUrl('webgl');
    expect(window.location.search).toContain('renderer=webgl');
  });

  it('validates renderer preference strings', () => {
    expect(isRendererPreference('webgl')).toBe(true);
    expect(isRendererPreference('webgpu')).toBe(true);
    expect(isRendererPreference('d3d11')).toBe(false);
  });
});
