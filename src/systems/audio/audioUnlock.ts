/**
 * audioUnlock.ts — the first user gesture, as a one-shot gate.
 *
 * Audio decode used to start while Rapier and the SWE WASM were still booting:
 * AudioManager's constructor fired `THREE.AudioLoader` for the critical SFX,
 * contending for the main thread (fetch + decode callbacks) during the slowest
 * part of startup — for a context the browser keeps suspended until a gesture
 * anyway. The gate opens on the Start click / Enter / first pointer lock, and
 * AudioManager holds every fetch until then.
 *
 * Browser autoplay policy counts `pointerdown`, `keydown` and `touchend` as
 * activation, so those are also the events where `AudioContext.resume()` is
 * allowed to succeed.
 */

type Listener = () => void;

export interface AudioUnlockGate {
  readonly unlocked: boolean;
  /** Runs `fn` on unlock (or immediately if already open). Returns an unsubscribe. */
  onUnlock(fn: Listener): () => void;
  /** Open the gate programmatically (tests, or a caller that knows better). */
  unlock(): void;
  dispose(): void;
}

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

export function createAudioUnlockGate(
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> | null =
    typeof window !== 'undefined' ? window : null,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'pointerLockElement'> | null =
    typeof document !== 'undefined' ? document : null,
): AudioUnlockGate {
  let unlocked = false;
  let listeners: Listener[] = [];

  const onGesture = () => open();
  const onPointerLock = () => {
    if (doc?.pointerLockElement) open();
  };

  function detach() {
    for (const type of GESTURE_EVENTS) win?.removeEventListener(type, onGesture, true);
    doc?.removeEventListener('pointerlockchange', onPointerLock);
  }

  function open() {
    if (unlocked) return;
    unlocked = true;
    detach();
    const pending = listeners;
    listeners = [];
    for (const fn of pending) {
      try {
        fn();
      } catch (error) {
        console.warn('[audioUnlock] listener failed:', error);
      }
    }
  }

  for (const type of GESTURE_EVENTS) win?.addEventListener(type, onGesture, true);
  doc?.addEventListener('pointerlockchange', onPointerLock);

  return {
    get unlocked() {
      return unlocked;
    },
    onUnlock(fn) {
      if (unlocked) {
        fn();
        return () => {};
      }
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((l) => l !== fn);
      };
    },
    unlock: open,
    dispose() {
      detach();
      listeners = [];
    },
  };
}
