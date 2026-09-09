/**
 * Boot-crash guard.
 *
 * A flag is written to `sessionStorage` immediately before the Canvas mounts and
 * cleared once the render loop has produced `HEALTHY_FRAME_COUNT` frames. If a
 * boot *starts* with the flag already set, the previous start never reached a
 * steady frame rate — it hung, crashed the GPU process, or the player killed the
 * tab while it was wedged.
 *
 * That is the one signal we get for "this machine cannot run what we asked for",
 * and it is worth something: the next boot skips the optimistic probe attempt,
 * clamps quality to `low`, and says so. A reproducible hard-crash-on-boot turns
 * into a degraded-but-playable session instead of a loop.
 *
 * Deliberately `sessionStorage`, not `localStorage`: this is about the tab in
 * front of the player right now. A machine that recovers should not carry the
 * clamp forever, and a new tab deserves a fresh, optimistic start.
 *
 * Deliberately no `beforeunload` clear: a reload during a wedged boot is exactly
 * the case this exists to catch, and clearing on unload would erase it.
 */

/** `sessionStorage` key. Namespaced like the rest of the app's storage. */
export const BOOT_GUARD_KEY = 'watershed:boot-in-progress';

/**
 * Frames the render loop must produce before a boot counts as healthy.
 *
 * ~1 second at 60 FPS: long enough that a first-frame crash, a shader compile
 * stall, or a WASM init failure has happened by then, short enough that a player
 * who alt-tabs away right after the menu paints is not mislabelled.
 */
export const HEALTHY_FRAME_COUNT = 60;

/** The slice of `Storage` this module needs; injectable for tests. */
export interface BootGuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `sessionStorage`, or null when it is unavailable.
 *
 * Private-mode Safari, storage-blocked embeds, and quota exhaustion all throw
 * on *access*, not just on write, so the whole thing is guarded. No storage
 * means no guard — an optimistic boot every time, which is the pre-existing
 * behaviour.
 */
function defaultStorage(): BootGuardStorage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Mark a boot as in progress, and report whether the previous one finished.
 *
 * @returns true when the previous boot never reached a steady frame rate.
 */
export function beginBootAttempt(storage: BootGuardStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  let previousBootFailed = false;
  try {
    previousBootFailed = storage.getItem(BOOT_GUARD_KEY) !== null;
    storage.setItem(BOOT_GUARD_KEY, String(Date.now()));
  } catch {
    return previousBootFailed;
  }
  if (previousBootFailed) {
    console.warn(
      '[Boot] The previous start never reached a steady frame rate — clamping to safe graphics.'
    );
  }
  return previousBootFailed;
}

/** Clear the in-progress flag: this boot made it to a steady frame rate. */
export function markBootHealthy(storage: BootGuardStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(BOOT_GUARD_KEY);
  } catch {
    // Nothing to do — a stale flag costs one clamped boot, not a broken one.
  }
}

/** Whether a boot attempt is currently marked in progress. Test/diagnostic use. */
export function isBootAttemptOpen(storage: BootGuardStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(BOOT_GUARD_KEY) !== null;
  } catch {
    return false;
  }
}
