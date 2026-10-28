/**
 * sfxVoices.ts — AudioManager's one-shot SFX voices.
 *
 * Parametric playback of SOUND_DEFS one-shots (volume / pitch / optional 3D
 * position), the per-category concurrency cap (the oldest voice in a full
 * category is stopped), the active-voice registry the diagnostics overlay
 * reads, and the synthesized thunder clap. Every voice scales by the SFX gain
 * — the settings channel times the wetness muffle — never by master, which the
 * listener applies once for everything.
 */

import * as THREE from 'three';
import { SOUND_DEFS, SoundCategory } from './soundDefs';
import type { SoundLibrary } from './soundLibrary';

// Active sound tracking
interface ActiveSound {
  name: string;
  source: THREE.Audio<AudioNode> | THREE.PositionalAudio;
  startTime: number;
}

export interface SfxVoices {
  /**
   * Play a sound with parametric control — see AudioManager.playSound.
   * Returns the sound instance id, or null if it was dropped or is loading.
   */
  play(name: string, volume: number, pitch: number, position?: THREE.Vector3): string | null;
  /**
   * Thunder one-shot — see AudioManager.playThunder. `clap` is only asked for
   * once the gate is open. Untracked: not a SOUND_DEFS entry, so no category cap.
   */
  playThunder(clap: () => AudioBuffer | null, volume: number, delaySeconds: number, pitch: number): boolean;
  /** Stop a specific sound or all instances of a sound. */
  stop(name: string, id?: string): void;
  /** Currently playing one-shots with elapsed seconds (diagnostics overlay). */
  snapshot(): { name: string; elapsed: number }[];
  /** Stop every tracked voice (manager dispose). */
  stopAll(): void;
}

/**
 * @param canPlay False while muted or before the unlock gesture: the one-shot is dropped.
 * @param sfxGain SFX channel × wetness muffle (AudioManager.getEffectiveSfxGain).
 */
export function createSfxVoices(
  listener: THREE.AudioListener,
  library: SoundLibrary,
  canPlay: () => boolean,
  sfxGain: () => number,
): SfxVoices {
  const activeSounds = new Map<string, ActiveSound[]>();
  // Category limits tracking
  const categoryCounts = new Map<SoundCategory, number>();
  Object.values(SoundCategory).forEach(cat => {
    categoryCounts.set(cat, 0);
  });
  /** Monotonic suffix for active-sound ids. */
  let soundSerial = 0;

  function play(
    name: string,
    volume: number,
    pitch: number,
    position?: THREE.Vector3
  ): string | null {
    // Before the first gesture the context is suspended and nothing is loaded;
    // queueing would replay stale one-shots at unlock, so just drop them.
    if (!canPlay()) return null;

    const def = SOUND_DEFS[name];
    if (!def) {
      library.warnUnknown(name);
      return null;
    }

    // Check category concurrent limit
    const currentCount = categoryCounts.get(def.category) || 0;
    if (currentCount >= def.maxConcurrent) {
      // Replace oldest sound in category
      stopOldestInCategory(def.category);
    }

    // Get or load buffer
    const buffer = library.get(name);
    if (!buffer) {
      // Try to load on-demand. Only retry on success — a missing file would
      // otherwise bounce between load and play forever.
      void library.load(name).then((loaded) => {
        if (loaded) play(name, volume, pitch, position);
      });
      return null;
    }

    // Create audio source
    let source: THREE.Audio<AudioNode> | THREE.PositionalAudio;
    if (position) {
      const positional = new THREE.PositionalAudio(listener);
      positional.position.copy(position);
      positional.setRefDistance(10);
      positional.setRolloffFactor(1);
      positional.setDistanceModel('inverse');
      source = positional;
    } else {
      source = new THREE.Audio(listener) as THREE.Audio<AudioNode>;
    }

    // Set buffer
    source.setBuffer(buffer);

    // Apply parametric controls. Master is handled by the listener's global gain
    // (setMasterVolume), so one-shots only scale by the SFX channel here to avoid
    // squaring the master multiplier.
    const finalVolume = Math.max(
      0,
      Math.min(1, volume * def.baseVolume * sfxGain()),
    );
    const finalPlaybackRate = Math.max(0.5, Math.min(2.0, pitch)); // For pitch shifting

    source.setVolume(finalVolume);
    source.setPlaybackRate(finalPlaybackRate);

    // Generate unique ID
    const id = `${name}_${(soundSerial += 1)}`;

    // Track active sound
    if (!activeSounds.has(name)) {
      activeSounds.set(name, []);
    }
    activeSounds.get(name)!.push({
      name,
      source,
      startTime: Date.now(),
    });

    // Update category count
    categoryCounts.set(def.category, currentCount + 1);

    // Play and cleanup
    source.play();

    source.onEnded = () => {
      cleanupSound(name, id);
    };

    return id;
  }

  /**
   * Stop the oldest sound in a category
   */
  function stopOldestInCategory(category: SoundCategory): void {
    let oldest: ActiveSound | null = null;
    let oldestName = '';

    for (const [name, sounds] of activeSounds) {
      const def = SOUND_DEFS[name];
      if (def?.category === category && sounds.length > 0) {
        const candidate = sounds[0]; // Oldest
        if (!oldest || candidate.startTime < oldest.startTime) {
          oldest = candidate;
          oldestName = name;
        }
      }
    }

    if (oldest) {
      oldest.source.stop();
      cleanupSound(oldestName, `${oldestName}_${oldest.startTime}`);
    }
  }

  /**
   * Cleanup after sound ends
   */
  function cleanupSound(name: string, id: string): void {
    const active = activeSounds.get(name);
    if (!active) return;

    const idx = active.findIndex(s => s.startTime.toString() === id.split('_')[1]);
    if (idx >= 0) {
      const sound = active[idx];
      active.splice(idx, 1);

      // Update category count
      const def = SOUND_DEFS[name];
      if (def) {
        const count = categoryCounts.get(def.category) || 0;
        categoryCounts.set(def.category, Math.max(0, count - 1));
      }

      // Dispose source
      sound.source.disconnect();
    }
  }

  return {
    play,

    playThunder(clap, volume, delaySeconds, pitch) {
      if (!canPlay()) return false;
      const buffer = clap();
      if (!buffer) return false;
      const source = new THREE.Audio(listener) as THREE.Audio<AudioNode>;
      source.setBuffer(buffer);
      source.setVolume(Math.max(0, Math.min(1, volume * sfxGain())));
      source.setPlaybackRate(Math.max(0.5, Math.min(2, pitch)));
      const ended = source.onEnded.bind(source);
      source.onEnded = () => {
        ended();
        source.disconnect();
      };
      source.play(Math.max(0, delaySeconds));
      return true;
    },

    stop(name, id) {
      const active = activeSounds.get(name);
      if (!active) return;

      if (id) {
        // Stop specific instance
        const idx = active.findIndex(s => s.name === id); // Simplified - actual ID tracking needed
        if (idx >= 0) {
          active[idx].source.stop();
          cleanupSound(name, id);
        }
      } else {
        // Stop all instances
        active.forEach(s => s.source.stop());
        activeSounds.set(name, []);
      }
    },

    snapshot() {
      const now = Date.now();
      const result: { name: string; elapsed: number }[] = [];
      activeSounds.forEach((sounds) => {
        sounds.forEach((s) => {
          result.push({
            name: s.name,
            elapsed: (now - s.startTime) / 1000,
          });
        });
      });
      return result;
    },

    stopAll() {
      activeSounds.forEach((sounds) => {
        sounds.forEach(s => s.source.stop());
      });
      activeSounds.clear();
    },
  };
}
