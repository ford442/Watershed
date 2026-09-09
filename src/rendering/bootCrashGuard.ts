/**
 * Boot-crash guard.
 *
 * A record is written to `sessionStorage` immediately before the Canvas mounts
 * and cleared as soon as the render loop produces its **first frame**. If a boot
 * *starts* with a record already present, the previous start never got a working
 * context — and the record says which way it failed.
 *
 * **First frame, not N frames.** An earlier draft cleared the flag after ~60
 * frames. That is wrong: a cold boot on a slow-but-healthy machine spends real
 * time in shader compilation, WASM instantiation, and asset decode, so a player
 * who reloads during a long-but-fine startup would be clamped to `low` for no
 * reason. One rendered frame is the honest proof: the context exists, the scene
 * graph committed, and the GPU drew. Anything after that is a performance
 * question, not a "can this machine run WebGL" question — and this guard only
 * answers the second one.
 *
 * The three ways a boot is judged to have failed, all evidence-based:
 *
 * - `no-frame` — armed at boot, never cleared. The previous session mounted the
 *   Canvas and never drew.
 * - `context-lost` — `webglcontextlost` fired (App records it). A GPU reset or
 *   a driver kill.
 * - `renderer-throw` — `createGameRenderer` threw out of the R3F `gl` factory.
 *
 * Self-healing is tied to the record, not to a timer: the next boot that draws a
 * frame clears it, and the boot after that is optimistic again.
 *
 * Deliberately `sessionStorage`, not `localStorage`: this is about the tab in
 * front of the player right now. Deliberately no `beforeunload` clear: a reload
 * during a wedged boot is exactly the case this exists to catch.
 */

/** `sessionStorage` key. Namespaced like the rest of the app's storage. */
export const BOOT_GUARD_KEY = 'watershed:boot-failure';

/** How a boot failed. Ordered by how specific the evidence is. */
export type BootFailureReason = 'no-frame' | 'context-lost' | 'renderer-throw';

export interface BootFailureRecord {
  reason: BootFailureReason;
  /** `Date.now()` when the record was armed or upgraded. */
  at: number;
}

/**
 * Frames the render loop must produce before a boot counts as healthy.
 *
 * One. See the module comment — this is a "does WebGL work here" guard, not a
 * frame-rate guard, and holding it open longer only produces false positives on
 * slow machines.
 */
export const FRAMES_TO_HEALTHY = 1;

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

const isFailureReason = (value: unknown): value is BootFailureReason =>
  value === 'no-frame' || value === 'context-lost' || value === 'renderer-throw';

/** Read the armed/left-behind record, or null. Tolerates a corrupt value. */
export function readBootFailure(
  storage: BootGuardStorage | null = defaultStorage()
): BootFailureRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BOOT_GUARD_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { reason, at } = parsed as Partial<BootFailureRecord>;
    if (!isFailureReason(reason)) return null;
    return { reason, at: typeof at === 'number' ? at : 0 };
  } catch {
    // Unparseable (or unreadable) means "no usable evidence", which is the same
    // as no record — an unexplained clamp is worse than an optimistic boot.
    return null;
  }
}

function write(storage: BootGuardStorage, record: BootFailureRecord): void {
  try {
    storage.setItem(BOOT_GUARD_KEY, JSON.stringify(record));
  } catch {
    // A guard that cannot persist costs one un-clamped boot, not a broken one.
  }
}

/**
 * Arm the guard for this boot, and report the previous boot's failure.
 *
 * @returns the record the previous boot left behind, or null when it drew.
 */
export function beginBootAttempt(
  storage: BootGuardStorage | null = defaultStorage()
): BootFailureRecord | null {
  if (!storage) return null;
  const previous = readBootFailure(storage);
  // Assume the pessimistic reason until a frame proves otherwise; a more
  // specific failure (context loss, renderer throw) upgrades it in place.
  write(storage, { reason: 'no-frame', at: Date.now() });
  if (previous) {
    console.warn(
      `[Boot] The previous start failed (${previous.reason}) — clamping to safe graphics.`
    );
  }
  return previous;
}

/**
 * Record *why* this boot is failing, replacing the armed `no-frame` assumption.
 *
 * Called from the two places that see a real failure: the `gl` factory's catch,
 * and the `webglcontextlost` handler.
 */
export function recordBootFailure(
  reason: BootFailureReason,
  storage: BootGuardStorage | null = defaultStorage()
): void {
  if (!storage) return;
  write(storage, { reason, at: Date.now() });
}

/** Clear the record: this boot produced a frame. */
export function markBootHealthy(storage: BootGuardStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(BOOT_GUARD_KEY);
  } catch {
    // Nothing to do — a stale record costs one clamped boot, not a broken one.
  }
}

/** Whether a boot attempt is currently marked as failing. Test/diagnostic use. */
export function isBootAttemptOpen(storage: BootGuardStorage | null = defaultStorage()): boolean {
  return readBootFailure(storage) !== null;
}
