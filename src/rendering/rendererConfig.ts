import type { RendererPreference } from './types';

const STORAGE_KEY = 'watershed.renderer.preference';
const VALID: RendererPreference[] = ['webgl', 'webgpu'];
// NOTE: 'webgpu' is accepted as a preference but currently results in a WebGL2
// fallback. The live renderer is WebGL-only; see docs/reference/RENDERER_CONTRACT.md.

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

  // Default: WebGL2 — the only live renderer. The 'webgpu' preference is a no-op
  // fallback to WebGL2 today; it exists only for the future #256 path A migration.
  // See docs/reference/RENDERER_CONTRACT.md.
  return 'webgl';
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

/**
 * Visual capture harnesses (?screenshot=1 / ?capture=1) require preserveDrawingBuffer.
 * Never enable it outside those modes — it costs GPU memory and hurts performance.
 */
export function isVisualCaptureMode(search?: string): boolean {
  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(raw);
  return params.get('screenshot') === '1' || params.get('capture') === '1';
}

/**
 * True when software GL (SwiftShader, llvmpipe) is an acceptable backend.
 *
 * Production pins `failIfMajorPerformanceCaveat: true` above the `low` preset so
 * a software rasterizer cannot silently boot and read as a shipped GPU. The
 * visual-smoke harness and CI *do* run on SwiftShader, so they opt out
 * explicitly: `?screenshot=1` / `?capture=1` already mark a capture run, and
 * `?softwareGl=1` covers a manual or headless run that is not capturing.
 */
export function isSoftwareRendererAllowed(search?: string): boolean {
  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (isVisualCaptureMode(raw)) return true;
  const params = new URLSearchParams(raw);
  return params.get('softwareGl') === '1';
}
