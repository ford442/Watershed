/**
 * soundLibrary.ts — AudioManager's decoded-buffer registry.
 *
 * Sound name → AudioBuffer, with one fetch + decode per payload file shared by
 * every name that resolves to it (aliases in soundDefs.ts), and failures
 * remembered so a missing file is asked for once. Nothing is fetched before
 * the unlock gesture (audioUnlock.ts); after it, the sounds a run needs first
 * trickle in at idle.
 */

import * as THREE from 'three';
import { PRELOAD_SOUNDS, SOUND_DEFS, resolveSoundFile, type SoundFileDef } from './soundDefs';
import { seamLoopBuffer } from './loopBuffer';
import type { AudioUnlockGate } from './audioUnlock';

const BASE_SOUND_URL = import.meta.env.BASE_URL || '/';

function soundUrl(def: SoundFileDef): string {
  return `${BASE_SOUND_URL}sounds/${def.file}`;
}

/** Idle-time scheduling so post-unlock preload never lands on the first game frames. */
function whenIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 1500 });
  else setTimeout(fn, 250);
}

export interface SoundLibrary {
  /** A loaded buffer, or undefined while it is still loading (or missing). */
  get(name: string): AudioBuffer | undefined;
  /**
   * Load a sound into memory. Before the unlock gesture this waits for it
   * rather than fetching — callers that `await` simply resume after Start.
   * Missing or undecodable files resolve null and are remembered (non-fatal).
   */
  load(name: string): Promise<AudioBuffer | null>;
  /**
   * One-shot warning for a name with no SOUND_DEFS entry; remembered with the
   * failed loads so the diagnostics overlay lists it.
   */
  warnUnknown(name: string): void;
  /** Warm the run's first sounds once the browser is idle (call after unlock). */
  preloadWhenIdle(): void;
  /** Load status for the diagnostics overlay. */
  status(): { loaded: number; total: number; failed: string[]; soundNames: string[] };
  /** Drop every decoded buffer and in-flight load (manager dispose). */
  clear(): void;
}

/**
 * @param context    Decode target for re-seamed loops (null: beds stay as decoded).
 * @param unlockGate Opens on the first gesture; nothing is fetched before it.
 */
export function createSoundLibrary(context: AudioContext | null, unlockGate: AudioUnlockGate): SoundLibrary {
  // Isolated from THREE.DefaultLoadingManager so boot SFX preload does not
  // block the UI loader (and stays out of drei's useProgress overlay).
  const loader = new THREE.AudioLoader(new THREE.LoadingManager());
  const sounds = new Map<string, AudioBuffer>();
  // One fetch + decode per payload file, shared by every name that resolves
  // to it (aliases in soundDefs.ts). Keyed by file basename.
  const fileLoads = new Map<string, Promise<AudioBuffer | null>>();
  const failed = new Set<string>();
  let preloadStarted = false;

  /**
   * Post-unlock warm-up of the sounds a run needs first. Sequential on purpose:
   * the game is already running, so trickle rather than burst. Idempotent.
   */
  async function preload(): Promise<void> {
    if (preloadStarted) return;
    preloadStarted = true;
    for (const name of PRELOAD_SOUNDS) {
      await load(name);
    }
  }

  async function load(name: string): Promise<AudioBuffer | null> {
    const cached = sounds.get(name);
    if (cached) return cached;

    if (failed.has(name)) {
      return null;
    }

    const def = resolveSoundFile(name);
    if (!def) {
      console.warn(`[AudioManager] Sound not found: ${name}`);
      failed.add(name);
      return null;
    }

    if (!unlockGate.unlocked) {
      await new Promise<void>((resolve) => unlockGate.onUnlock(resolve));
    }

    const buffer = await loadFile(def);
    if (buffer) {
      sounds.set(name, buffer);
      failed.delete(name);
    } else {
      failed.add(name);
    }
    return buffer;
  }

  function loadFile(def: SoundFileDef): Promise<AudioBuffer | null> {
    const pending = fileLoads.get(def.file);
    if (pending) return pending;

    const pendingLoad = loader
      .loadAsync(soundUrl(def))
      .then((buffer) => (def.loop ? seamLoop(buffer) : buffer))
      .catch(() => {
        console.warn(`[AudioManager] Failed to load sound file: ${def.file}`);
        return null;
      });
    fileLoads.set(def.file, pendingLoad);
    return pendingLoad;
  }

  /** Re-seam a decoded bed so MP3 priming/padding doesn't gap the loop. */
  function seamLoop(buffer: AudioBuffer): AudioBuffer {
    const ctx = context;
    if (!ctx) return buffer;
    return seamLoopBuffer(buffer, (channels, length, sampleRate) =>
      ctx.createBuffer(channels, length, sampleRate),
    );
  }

  return {
    get: (name) => sounds.get(name),
    load,
    warnUnknown(name) {
      if (failed.has(name)) return;
      console.warn(`[AudioManager] Unknown sound: ${name}`);
      failed.add(name);
    },
    preloadWhenIdle: () => whenIdle(() => preload()),
    status() {
      const soundNames = Object.keys(SOUND_DEFS);
      return {
        loaded: sounds.size,
        total: soundNames.length,
        failed: Array.from(failed),
        soundNames,
      };
    },
    clear() {
      sounds.clear();
      fileLoads.clear();
    },
  };
}
