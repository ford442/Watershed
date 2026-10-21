/**
 * handheld.ts — how big is the screen a touch player plays on (#486 C).
 *
 * Fetched only on a touch device (`touchMode.ts` decides that). The pure helpers
 * take their inputs as arguments and are unit-tested.
 *
 * `applyHandheldEnvelope` publishes the visual viewport as CSS custom
 * properties on `<html>` — `--vv-w`, `--vv-h` and `--hud-scale` — so the HUD
 * can scale to the handheld screen without the CSS knowing about
 * `visualViewport`. Safe-area insets are left to CSS `env(safe-area-inset-*)`.
 */

/** The shortest side below which the HUD starts to shrink, and the floor of the shrink. */
const HUD_FULL_SIDE = 720;
const HUD_MIN_SCALE = 0.7;

/** HUD scale for a viewport: 1 at ≥ 720 px on the short side, down to 0.7 on a small phone. */
export function handheldHudScale(width: number, height: number): number {
  const side = Math.min(width, height);
  if (!(side > 0)) return 1;
  return Math.max(HUD_MIN_SCALE, Math.min(1, side / HUD_FULL_SIDE));
}

export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

/** Stick radius in px for a viewport: ~14 % of the short side, clamped to a thumb-sized range. */
export function stickRadiusPx(width: number, height: number): number {
  return Math.max(44, Math.min(90, Math.min(width, height) * 0.14));
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function readViewport(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  const vv = window.visualViewport;
  return { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
}

/**
 * Publish the viewport as CSS variables and keep them current. Returns a
 * disposer. Touch devices only get a `touch-input` class on `<html>`, which the
 * stylesheet uses for `touch-action: none` on the canvas.
 */
export function applyHandheldEnvelope(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    const { width, height } = readViewport();
    root.style.setProperty('--vv-w', `${Math.round(width)}px`);
    root.style.setProperty('--vv-h', `${Math.round(height)}px`);
    root.style.setProperty('--hud-scale', handheldHudScale(width, height).toFixed(3));
    root.dataset.orientation = isPortrait(width, height) ? 'portrait' : 'landscape';
  };
  root.classList.add('touch-input');
  apply();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    vv?.removeEventListener('resize', apply);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
    root.classList.remove('touch-input');
    root.style.removeProperty('--vv-w');
    root.style.removeProperty('--vv-h');
    root.style.removeProperty('--hud-scale');
    delete root.dataset.orientation;
  };
}

/** Best-effort landscape lock. Most browsers only honour it fullscreen; failure is expected and silent. */
export function tryLockLandscape(): void {
  const orientation = typeof screen !== 'undefined' ? (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }) : undefined;
  orientation?.lock?.('landscape')?.catch?.(() => undefined);
}
