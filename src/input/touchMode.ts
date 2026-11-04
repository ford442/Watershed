/**
 * touchMode.ts — is this page a touch device? (#486 C)
 *
 * Touch input is on when the page asks for it (`?input=touch`, which also lets
 * a desktop test the layout) or the primary pointer is coarse
 * (`(pointer: coarse)`). The answer is a property of the page load, so it is
 * resolved once and cached. Kept tiny and separate from `handheld.ts` because
 * App and the scene read it at boot, while the envelope code is only fetched on
 * a touch device.
 */

import { currentSearch, queryFlags } from '../config/queryFlags';
const TOUCH_FLAG = 'touch';

/** `?input=touch` — force the touch layout (desktop testing). */
export function isTouchInputForced(search: string = currentSearch()): boolean {
  return new URLSearchParams(search).get('input') === TOUCH_FLAG;
}

/** `?input=keyboard` (or anything but touch) never forces touch off a coarse device; this only reads the media query. */
export function hasCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

let cachedTouchMode: boolean | null = null;

/** Touch input for this page load. Cached; a scripted run is never touch. */
export function isTouchInputMode(): boolean {
  if (cachedTouchMode !== null) return cachedTouchMode;
  if (typeof window === 'undefined') return false;
  const scripted = queryFlags().input?.startsWith('script:') ?? false;
  cachedTouchMode = !scripted && (isTouchInputForced() || hasCoarsePointer());
  return cachedTouchMode;
}

/** Tests only. */
export function resetTouchInputModeForTest(): void {
  cachedTouchMode = null;
}

