/**
 * useScreenshotApi.ts — installs `window.__watershedScreenshot` on a
 * `?screenshot=1` page (#521 C2), split out of useExperienceWorld.
 *
 * Only the flag check lives in the entry chunk; the API itself is
 * `screenshotApi.ts`, fetched behind the flag. The world hook mounts with the
 * Canvas, long before a harness clicks Start, so the chunk is in by the time a
 * script polls for the API (they all wait for it). Once loaded, every later
 * reinstall (a new segment, new spawn points) is synchronous in the effect,
 * exactly as when it was inline.
 */
import { useEffect } from 'react';
import { queryFlags } from '../config/queryFlags';
import { lazyModule } from '../utils/lazyModule';
import type { ScreenshotApiContext } from './screenshotApi';

const screenshotApi = lazyModule(() => import('./screenshotApi'));

export function useScreenshotApi({
  vehicleRef,
  trackManagerRef,
  spawnPoints,
  currentSegmentIndex,
  mapStartIndex,
  setCurrentSegmentIndex,
  setRespawnSegmentIndex,
}: ScreenshotApiContext): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !queryFlags().screenshot) {
      return undefined;
    }

    const context: ScreenshotApiContext = {
      vehicleRef,
      trackManagerRef,
      spawnPoints,
      currentSegmentIndex,
      mapStartIndex,
      setCurrentSegmentIndex,
      setRespawnSegmentIndex,
    };
    const loaded = screenshotApi.get();
    if (loaded) return loaded.installScreenshotApi(context);

    // First install: wait for the chunk. A deps change (or unmount) before it
    // lands cancels this one; the next run of the effect installs instead.
    let cancelled = false;
    let uninstall: (() => void) | undefined;
    screenshotApi.load().then(
      (mod) => {
        if (!cancelled) uninstall = mod.installScreenshotApi(context);
      },
      (error: unknown) => {
        console.warn('[useScreenshotApi] screenshot API chunk failed to load', error);
      },
    );
    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [
    currentSegmentIndex,
    mapStartIndex,
    setCurrentSegmentIndex,
    setRespawnSegmentIndex,
    spawnPoints,
    trackManagerRef,
    vehicleRef,
  ]);
}
