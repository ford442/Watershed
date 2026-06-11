import type { RendererPreference } from './types';

const STORAGE_KEY = 'watershed.renderer.preference';
const VALID: RendererPreference[] = ['webgl', 'webgpu'];

export function parseRendererPreference(search = window.location.search): RendererPreference {
  const raw = new URLSearchParams(search).get('renderer');
  if (raw === 'webgl' || raw === 'webgpu') return raw;

  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'webgl' || stored === 'webgpu') return stored;
    } catch {
      // ignore storage failures
    }
  }

  // Default: WebGPU path (auto-falls back to WebGL2 when unavailable).
  return 'webgpu';
}

export function isRendererPreference(value: string): value is RendererPreference {
  return (VALID as string[]).includes(value);
}

export function syncRendererPreferenceToUrl(preference: RendererPreference): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set('renderer', preference);
  const next = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}?${next}`);
}

export function persistRendererPreference(preference: RendererPreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // ignore storage failures
  }
  syncRendererPreferenceToUrl(preference);
}
