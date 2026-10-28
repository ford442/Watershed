/**
 * AudioSystem.ts - Parametric sound system for Watershed
 *
 * RESPONSIBILITIES:
 * - Manage Three.js audio context and listener
 * - Own the unlock gate (nothing loads before the first gesture)
 * - Facade over the per-voice modules (the only import outside this folder):
 *   - audioMix.ts — master / music / SFX / mute + reactive layer volumes
 *   - soundLibrary.ts — buffer loading / registry, post-unlock preload
 *   - sfxVoices.ts — one-shot SFX (spatial, category caps) + thunder
 *   - ambientBed.ts — the looping ambient track and its crossfade
 *   - acousticRouting.ts — canyon acoustics + wetness muffle filter chains
 *   - synthBuffers.ts — the synthesized speed-wind loop and thunder clap
 */

import * as THREE from 'three';
import { collisionSoundFor, footstepSoundFor } from './soundDefs';
import { DEFAULT_WALL_WETNESS } from './canyonAcoustics';
import { createAudioUnlockGate, type AudioUnlockGate } from './audioUnlock';
import { createAudioMix, type AudioMix, type ReactiveVolumes } from './audioMix';
import { createSoundLibrary, type SoundLibrary } from './soundLibrary';
import { createSfxVoices, type SfxVoices } from './sfxVoices';
import { createAmbientBed, type AmbientBed } from './ambientBed';
import {
  createAcousticRouter,
  wetnessCutoffHz,
  type AcousticRouter,
  type AcousticStem,
  type RoutableAudio,
} from './acousticRouting';
import { createSynthBuffers, type SynthBuffers } from './synthBuffers';

export { SoundCategory } from './soundDefs';
export type { AcousticStem } from './acousticRouting';

export class AudioManager {
  private listener: THREE.AudioListener;
  private audioContext: AudioContext | null = null;
  /** Opens on the first gesture; nothing is fetched before it (see audioUnlock.ts). */
  private readonly unlockGate: AudioUnlockGate;
  private readonly mix: AudioMix;
  private readonly library: SoundLibrary;
  private readonly voices: SfxVoices;
  private readonly ambient: AmbientBed;
  private readonly acoustics: AcousticRouter;
  private readonly synth: SynthBuffers;

  constructor(camera: THREE.Camera) {
    // Create audio listener and attach to camera
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    // Cache the underlying Web Audio context for introspection
    this.audioContext = this.listener.context as AudioContext;

    // No preload here: this runs during Rapier + WASM boot. Fetch and decode
    // wait for the Start click / Enter / pointer lock instead.
    this.unlockGate = createAudioUnlockGate();
    this.mix = createAudioMix(this.listener);
    this.library = createSoundLibrary(this.audioContext, this.unlockGate);
    this.acoustics = createAcousticRouter(this.audioContext);
    this.synth = createSynthBuffers(this.audioContext);
    this.voices = createSfxVoices(
      this.listener,
      this.library,
      () => !this.mix.muted() && this.unlockGate.unlocked,
      this.mix.effectiveSfxGain,
    );
    this.ambient = createAmbientBed(this.listener, this.library, this.acoustics, this.mix.music);
    this.unlockGate.onUnlock(() => this.handleUnlock());
  }

  /** Whether the first gesture has happened (and loading is allowed). */
  isUnlocked(): boolean {
    return this.unlockGate.unlocked;
  }

  /** Open the gate without a gesture (tests / tooling). */
  unlock(): void {
    this.unlockGate.unlock();
  }

  private handleUnlock(): void {
    // A context created before any gesture starts suspended; this gesture is
    // the one the browser will let resume it.
    const ctx = this.audioContext;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {
        // Non-fatal — the next gesture-driven play will try again.
      });
    }
    this.library.preloadWhenIdle();
  }

  /** Get the audio listener (for attaching to moving objects) */
  getListener(): THREE.AudioListener {
    return this.listener;
  }

  /** Get a loaded audio buffer by sound name */
  getBuffer(name: string): AudioBuffer | undefined {
    return this.library.get(name);
  }

  /** Load a sound; before the unlock gesture this waits for it. Missing files resolve null. */
  loadSound(name: string): Promise<AudioBuffer | null> {
    return this.library.load(name);
  }

  /**
   * Play a sound with parametric control
   *
   * @param name Sound identifier
   * @param volume Volume multiplier (0-1)
   * @param pitch Pitch multiplier (0.5-2.0)
   * @param position Optional 3D position for spatial audio
   * @returns Sound instance ID or null if failed
   */
  playSound(
    name: string,
    volume: number = 1.0,
    pitch: number = 1.0,
    position?: THREE.Vector3
  ): string | null {
    return this.voices.play(name, volume, pitch, position);
  }

  /** Stop a specific sound or all instances of a sound */
  stopSound(name: string, id?: string): void {
    this.voices.stop(name, id);
  }

  /** Set ambient background track (crossfade over `fadeDuration` ms) */
  setAmbient(trackName: string, fadeDuration: number = 1000): void {
    this.ambient.set(trackName, fadeDuration);
  }

  /** Set master volume (the listener's global gain; held at 0 while muted) */
  setMasterVolume(volume: number): void {
    this.mix.setMaster(volume);
  }

  /** Music-channel multiplier (ambient stems). Read transiently by ReactiveAudio. */
  setMusicVolume(volume: number): void {
    this.mix.setMusic(volume);
  }

  getMusicVolume(): number {
    return this.mix.music();
  }

  /** SFX-channel multiplier (one-shots + reactive sfx). Read transiently by ReactiveAudio. */
  setSfxVolume(volume: number): void {
    this.mix.setSfx(volume);
  }

  getSfxVolume(): number {
    return this.mix.sfx();
  }

  /**
   * SFX channel scaled by the live wetness muffle — what a one-shot or a
   * reactive SFX bed should actually multiply by. `getSfxVolume` stays the raw
   * settings value so the settings panel keeps reading back what the user set.
   */
  getEffectiveSfxGain(): number {
    return this.mix.effectiveSfxGain();
  }

  /** Synthesized speed-wind loop (#399) — not `ambient_wind`; cached per manager. */
  getSpeedWindBuffer(): AudioBuffer | null {
    return this.synth.speedWindLoop();
  }

  /** Synthesized thunder clap (#464) — no asset; generated once per manager and cached. */
  getThunderBuffer(): AudioBuffer | null {
    return this.synth.thunderClap();
  }

  /**
   * Thunder one-shot for a lightning strike, `delaySeconds` after the flash
   * (sound travel). Not a SOUND_DEFS entry — the buffer is synthesized — but it
   * obeys the same mute / unlock / SFX-channel rules as `playSound`.
   */
  playThunder(volume = 1, delaySeconds = 0, pitch = 1): boolean {
    return this.voices.playThunder(() => this.getThunderBuffer(), volume, delaySeconds, pitch);
  }

  /** Wetness-muffle lowpass in Hz, or null when dry enough to skip the filter node. */
  getWetnessCutoffHz(): number | null {
    return wetnessCutoffHz();
  }

  /** Mute/unmute all audio */
  setMuted(muted: boolean): void {
    this.mix.setMuted(muted);
  }

  /** Get load status for diagnostics overlay */
  getLoadStatus(): { loaded: number; total: number; failed: string[]; soundNames: string[] } {
    return this.library.status();
  }

  /** Get currently playing sounds with elapsed time */
  getActiveSounds(): { name: string; elapsed: number }[] {
    return this.voices.snapshot();
  }

  /** Get the Web Audio context state */
  getAudioContextState(): string {
    return this.audioContext?.state ?? 'unknown';
  }

  /**
   * Enable canyon acoustics for routed layers.
   *
   * @param wallTightness 0 (open) – 1 (slot), from the biome's TrackBiomeProfile.
   * @param wallWetness   0 (absorbent) – 1 (wet ice / concrete); see canyonAcoustics.ts.
   */
  enableCanyonAcoustics(wallTightness: number, wallWetness: number = DEFAULT_WALL_WETNESS): void {
    this.acoustics.enable(wallTightness, wallWetness);
  }

  /** Disable canyon acoustics. */
  disableCanyonAcoustics(): void {
    this.acoustics.disable();
  }

  /** Live wall tightness (0 when acoustics are off) — the speed-wind worklet reads it. */
  getCanyonWallTightness(): number {
    return this.acoustics.wallTightness();
  }

  /** Put a playing layer under canyon acoustics, re-routed on every wall change until `unrouteAcoustics`. */
  routeAcoustics(source: RoutableAudio, stem: AcousticStem = 'bed'): void {
    this.acoustics.route(source, stem);
  }

  /** Stop following canyon acoustics and strip the chain back to dry. */
  unrouteAcoustics(source: RoutableAudio): void {
    this.acoustics.unroute(source);
  }

  /** Apply/clear the filter chain (canyon sends + wetness muffle) — see acousticRouting.ts. */
  applyCanyonFilters(source: RoutableAudio, stem: AcousticStem = 'bed'): void {
    this.acoustics.applyCanyonFilters(source, stem);
  }

  /** Set reactive audio crossfade volumes (called by ReactiveAudio) */
  setReactiveVolumes(volumes: Partial<ReactiveVolumes>): void {
    this.mix.setReactive(volumes);
  }

  /** Get reactive audio crossfade volumes */
  getReactiveVolumes(): ReactiveVolumes {
    return this.mix.reactive();
  }

  /** Snapshot of reactive layers + canyon acoustic state for diagnostics. */
  getAudioState(): {
    layers: ReactiveVolumes;
    reverbActive: boolean;
    wallTightness: number;
    wallWetness: number;
    routedLayers: number;
  } {
    return { layers: this.getReactiveVolumes(), ...this.acoustics.state() };
  }

  /** Get material-specific collision sound */
  static getCollisionSound(material: string): string {
    return collisionSoundFor(material);
  }

  /** Footstep sound: `step_<material>` when the library has one, else `step_rock` (soundDefs.ts). */
  static getFootstepSound(material: string, isWet: boolean): string {
    return footstepSoundFor(material, isWet);
  }

  /** Dispose all audio resources */
  dispose(): void {
    this.voices.stopAll();
    this.ambient.stop();
    this.unlockGate.dispose();
    this.acoustics.clear();
    this.library.clear();
    this.synth.release();
    this.listener.removeFromParent();
  }
}

// Singleton instance
let audioManager: AudioManager | null = null;

export function initAudio(camera: THREE.Camera): AudioManager {
  if (!audioManager) {
    audioManager = new AudioManager(camera);
  }
  return audioManager;
}

export function getAudioManager(): AudioManager | null {
  return audioManager;
}

export function disposeAudio(): void {
  audioManager?.dispose();
  audioManager = null;
}
