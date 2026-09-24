/**
 * AudioSystem.ts - Parametric sound system for Watershed
 * 
 * RESPONSIBILITIES:
 * - Manage Three.js audio context and listener
 * - Load and play foley sounds with parametric control
 * - Handle spatial audio (PositionalAudio)
 * - Limit concurrent sounds to prevent clipping
 * - Manage ambient background tracks
 */

import * as THREE from 'three';
import { currentWetnessMuffle } from './wetnessMuffle';
import { fillSpeedWindChannel, speedWindLoopLength } from './speedWindBuffer';
import {
  PRELOAD_SOUNDS,
  SOUND_DEFS,
  SoundCategory,
  resolveSoundFile,
  type SoundFileDef,
} from './soundDefs';
import { seamLoopBuffer } from './loopBuffer';
import { canyonAcousticParams, DEFAULT_WALL_WETNESS } from './canyonAcoustics';
import { createAudioUnlockGate, type AudioUnlockGate } from './audioUnlock';

export { SoundCategory } from './soundDefs';

// Active sound tracking
interface ActiveSound {
  name: string;
  source: THREE.Audio<AudioNode> | THREE.PositionalAudio;
  startTime: number;
}

interface ReactiveVolumes {
  low: number;
  mid: number;
  high: number;
  rapids: number;
  whoosh: number;
  transition: number;
  /** Normalized speed-wind gain 0–1 (pre SFX/master multipliers). */
  wind?: number;
}

/**
 * Which acoustic treatment a routed layer gets. Only the rapids stem carries
 * early reflections — putting them on every bed smears the whole mix, and the
 * roar is what the walls are actually throwing back.
 */
export type AcousticStem = 'rapids' | 'bed';

type RoutableAudio = THREE.Audio<AudioNode> | THREE.PositionalAudio;

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

export class AudioManager {
  private listener: THREE.AudioListener;
  private loader: THREE.AudioLoader;
  /** Isolated from THREE.DefaultLoadingManager so boot SFX preload does not block the UI loader. */
  private readonly audioLoadingManager = new THREE.LoadingManager();
  private audioContext: AudioContext | null = null;
  private sounds: Map<string, AudioBuffer> = new Map();
  /**
   * One fetch + decode per payload file, shared by every name that resolves
   * to it (aliases in soundDefs.ts). Keyed by file basename.
   */
  private fileLoads: Map<string, Promise<AudioBuffer | null>> = new Map();
  /** Opens on the first gesture; nothing is fetched before it (see audioUnlock.ts). */
  private readonly unlockGate: AudioUnlockGate;
  private preloadStarted = false;
  private activeSounds: Map<string, ActiveSound[]> = new Map();
  private ambientTrack: THREE.Audio<AudioNode> | THREE.PositionalAudio | null = null;
  private ambientRequest = 0;
  private isMuted: boolean = false;
  private masterVolume: number = 1.0;
  // Per-channel multipliers driven by the settings panel. Applied on TOP of the
  // biome/speed ducking (never an override): master is the global listener gain,
  // music scales ambient stems, sfx scales one-shots + reactive sfx layers.
  private musicVolume: number = 1.0;
  private sfxVolume: number = 1.0;
  /** Lazily synthesized speed-wind loop — see getSpeedWindBuffer(). */
  private speedWindBuffer: AudioBuffer | null = null;

  // Category limits tracking
  private categoryCounts: Map<SoundCategory, number> = new Map();
  
  // Load status tracking
  private failedSounds: Set<string> = new Set();
  
  // Reactive audio volumes (populated by ReactiveAudio / SpeedWindAudio if mounted)
  private reactiveVolumes: ReactiveVolumes = {
    low: 0,
    mid: 0,
    high: 0,
    rapids: 0,
    whoosh: 0,
    transition: 0,
    wind: 0,
  };

  // Canyon acoustic state
  private canyonAcoustics = {
    active: false,
    wallTightness: 0,
    wallWetness: DEFAULT_WALL_WETNESS,
  };
  /** Layers that follow canyon acoustics, re-routed whenever the walls change. */
  private routedSources: Map<RoutableAudio, AcousticStem> = new Map();
  /** Send-bus nodes hung off each routed layer's chain, released on re-route. */
  private sendNodes: WeakMap<RoutableAudio, AudioNode[]> = new WeakMap();
  /** Synthetic impulse responses, cached per 50 ms of decay. */
  private impulseCache: Map<number, AudioBuffer> = new Map();
  
  constructor(camera: THREE.Camera) {
    // Create audio listener and attach to camera
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    
    // Create audio loader (private manager — avoid polluting drei's useProgress overlay)
    this.loader = new THREE.AudioLoader(this.audioLoadingManager);
    
    // Cache the underlying Web Audio context for introspection
    this.audioContext = this.listener.context as AudioContext;
    
    // Initialize category counts
    Object.values(SoundCategory).forEach(cat => {
      this.categoryCounts.set(cat, 0);
    });
    
    // No preload here: this runs during Rapier + WASM boot. Fetch and decode
    // wait for the Start click / Enter / pointer lock instead.
    this.unlockGate = createAudioUnlockGate();
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
    whenIdle(() => this.preloadSounds());
  }
  
  /**
   * Get the audio listener (for attaching to moving objects)
   */
  getListener(): THREE.AudioListener {
    return this.listener;
  }

  /**
   * Get a loaded audio buffer by sound name
   */
  getBuffer(name: string): AudioBuffer | undefined {
    return this.sounds.get(name);
  }
  
  /**
   * Post-unlock warm-up of the sounds a run needs first. Sequential on purpose:
   * the game is already running, so trickle rather than burst. Idempotent.
   */
  private async preloadSounds(): Promise<void> {
    if (this.preloadStarted) return;
    this.preloadStarted = true;
    for (const name of PRELOAD_SOUNDS) {
      await this.loadSound(name);
    }
  }

  /**
   * Load a sound into memory. Before the unlock gesture this waits for it
   * rather than fetching — callers that `await` simply resume after Start.
   * Missing or undecodable files resolve null and are remembered (non-fatal).
   */
  async loadSound(name: string): Promise<AudioBuffer | null> {
    const cached = this.sounds.get(name);
    if (cached) return cached;

    if (this.failedSounds.has(name)) {
      return null;
    }

    const def = resolveSoundFile(name);
    if (!def) {
      console.warn(`[AudioManager] Sound not found: ${name}`);
      this.failedSounds.add(name);
      return null;
    }

    if (!this.unlockGate.unlocked) {
      await new Promise<void>((resolve) => this.unlockGate.onUnlock(resolve));
    }

    const buffer = await this.loadFile(def);
    if (buffer) {
      this.sounds.set(name, buffer);
      this.failedSounds.delete(name);
    } else {
      this.failedSounds.add(name);
    }
    return buffer;
  }

  private loadFile(def: SoundFileDef): Promise<AudioBuffer | null> {
    const pending = this.fileLoads.get(def.file);
    if (pending) return pending;

    const load = this.loader
      .loadAsync(soundUrl(def))
      .then((buffer) => (def.loop ? this.seamLoop(buffer) : buffer))
      .catch(() => {
        console.warn(`[AudioManager] Failed to load sound file: ${def.file}`);
        return null;
      });
    this.fileLoads.set(def.file, load);
    return load;
  }

  /** Re-seam a decoded bed so MP3 priming/padding doesn't gap the loop. */
  private seamLoop(buffer: AudioBuffer): AudioBuffer {
    const ctx = this.audioContext;
    if (!ctx) return buffer;
    return seamLoopBuffer(buffer, (channels, length, sampleRate) =>
      ctx.createBuffer(channels, length, sampleRate),
    );
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
    if (this.isMuted) return null;
    // Before the first gesture the context is suspended and nothing is loaded;
    // queueing would replay stale one-shots at unlock, so just drop them.
    if (!this.unlockGate.unlocked) return null;

    const def = SOUND_DEFS[name];
    if (!def) {
      if (!this.failedSounds.has(name)) {
        console.warn(`[AudioManager] Unknown sound: ${name}`);
        this.failedSounds.add(name);
      }
      return null;
    }
    
    // Check category concurrent limit
    const currentCount = this.categoryCounts.get(def.category) || 0;
    if (currentCount >= def.maxConcurrent) {
      // Replace oldest sound in category
      this.stopOldestInCategory(def.category);
    }
    
    // Get or load buffer
    const buffer = this.sounds.get(name);
    if (!buffer) {
      // Try to load on-demand. Only retry on success — a missing file would
      // otherwise bounce between loadSound and playSound forever.
      this.loadSound(name).then((loaded) => {
        if (loaded) this.playSound(name, volume, pitch, position);
      });
      return null;
    }
    
    // Create audio source
    let source: THREE.Audio<AudioNode> | THREE.PositionalAudio;
    if (position) {
      const positional = new THREE.PositionalAudio(this.listener);
      positional.position.copy(position);
      (positional as THREE.PositionalAudio).setRefDistance(10);
      (positional as THREE.PositionalAudio).setRolloffFactor(1);
      (positional as THREE.PositionalAudio).setDistanceModel('inverse');
      source = positional;
    } else {
      source = new THREE.Audio(this.listener) as THREE.Audio<AudioNode>;
    }
    
    // Set buffer
    source.setBuffer(buffer);
    
    // Apply parametric controls. Master is handled by the listener's global gain
    // (setMasterVolume), so one-shots only scale by the SFX channel here to avoid
    // squaring the master multiplier.
    const finalVolume = Math.max(
      0,
      Math.min(1, volume * def.baseVolume * this.getEffectiveSfxGain()),
    );
    const finalPitch = Math.max(0.5, Math.min(2.0, pitch * def.basePitch));
    const finalPlaybackRate = Math.max(0.5, Math.min(2.0, pitch)); // For pitch shifting
    
    source.setVolume(finalVolume);
    source.setPlaybackRate(finalPlaybackRate);
    
    // Generate unique ID
    const id = `${name}_${Date.now()}_${Math.random()}`;
    
    // Track active sound
    if (!this.activeSounds.has(name)) {
      this.activeSounds.set(name, []);
    }
    this.activeSounds.get(name)!.push({
      name,
      source,
      startTime: Date.now(),
    });
    
    // Update category count
    this.categoryCounts.set(def.category, currentCount + 1);
    
    // Play and cleanup
    source.play();
    
    source.onEnded = () => {
      this.cleanupSound(name, id);
    };
    
    return id;
  }
  
  /**
   * Stop a specific sound or all instances of a sound
   */
  stopSound(name: string, id?: string): void {
    const active = this.activeSounds.get(name);
    if (!active) return;
    
    if (id) {
      // Stop specific instance
      const idx = active.findIndex(s => s.name === id); // Simplified - actual ID tracking needed
      if (idx >= 0) {
        active[idx].source.stop();
        this.cleanupSound(name, id);
      }
    } else {
      // Stop all instances
      active.forEach(s => s.source.stop());
      this.activeSounds.set(name, []);
    }
  }
  
  /**
   * Stop the oldest sound in a category
   */
  private stopOldestInCategory(category: SoundCategory): void {
    let oldest: ActiveSound | null = null;
    let oldestName = '';
    
    for (const [name, sounds] of this.activeSounds) {
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
      this.cleanupSound(oldestName, `${oldestName}_${oldest.startTime}`);
    }
  }
  
  /**
   * Cleanup after sound ends
   */
  private cleanupSound(name: string, id: string): void {
    const active = this.activeSounds.get(name);
    if (!active) return;
    
    const idx = active.findIndex(s => s.startTime.toString() === id.split('_')[1]);
    if (idx >= 0) {
      const sound = active[idx];
      active.splice(idx, 1);
      
      // Update category count
      const def = SOUND_DEFS[name];
      if (def) {
        const count = this.categoryCounts.get(def.category) || 0;
        this.categoryCounts.set(def.category, Math.max(0, count - 1));
      }
      
      // Dispose source
      sound.source.disconnect();
    }
  }
  
  /**
   * Set ambient background track
   */
  setAmbient(trackName: string, fadeDuration: number = 1000): void {
    // Only the latest request may install a track: loads can resolve out of
    // order (and all at once when the unlock gesture releases them).
    const request = ++this.ambientRequest;

    // Fade out current ambient
    if (this.ambientTrack) {
      const oldTrack = this.ambientTrack;
      this.ambientTrack = null;
      const startVol = oldTrack.getVolume();
      const fadeStart = Date.now();
      
      const fadeOut = () => {
        const elapsed = Date.now() - fadeStart;
        const t = Math.min(1, elapsed / fadeDuration);
        oldTrack.setVolume(startVol * (1 - t));
        
        if (t < 1) {
          requestAnimationFrame(fadeOut);
        } else {
          this.unrouteAcoustics(oldTrack);
          oldTrack.stop();
        }
      };
      fadeOut();
    }
    
    // Load and fade in new track
    this.loadSound(trackName).then(buffer => {
      if (!buffer || request !== this.ambientRequest) return;
      
      const track = new THREE.Audio(this.listener) as THREE.Audio<AudioNode>;
      this.ambientTrack = track;
      track.setBuffer(buffer);
      track.setLoop(true);
      track.setVolume(0);
      
      const def = SOUND_DEFS[trackName];
      const targetVol = (def?.baseVolume || 0.3) * this.musicVolume;
      const fadeStart = Date.now();
      
      const fadeIn = () => {
        const elapsed = Date.now() - fadeStart;
        const t = Math.min(1, elapsed / fadeDuration);
        this.ambientTrack?.setVolume(targetVol * t);
        
        if (t < 1) {
          requestAnimationFrame(fadeIn);
        }
      };
      
      track.play();
      this.routeAcoustics(track, resolveSoundFile(trackName)?.file === 'rapids_roar.mp3' ? 'rapids' : 'bed');
      fadeIn();
    });
  }
  
  /**
   * Set master volume
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (!this.isMuted) {
      this.listener.setMasterVolume(this.masterVolume);
    }
  }

  /** Music-channel multiplier (ambient stems). Read transiently by ReactiveAudio. */
  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  /** SFX-channel multiplier (one-shots + reactive sfx). Read transiently by ReactiveAudio. */
  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  /**
   * SFX channel scaled by the live wetness muffle — what a one-shot or a
   * reactive SFX bed should actually multiply by. `getSfxVolume` stays the raw
   * settings value so the settings panel keeps reading back what the user set.
   */
  getEffectiveSfxGain(): number {
    return this.sfxVolume * currentWetnessMuffle().gain;
  }

  /**
   * Distinct, synthesized speed-wind loop (#399 audio leftovers).
   *
   * The velocity bed used to reuse the `ambient_wind` asset, so it masked the
   * biome ambience it was layered over. Generated once per manager and cached.
   */
  getSpeedWindBuffer(): AudioBuffer | null {
    if (this.speedWindBuffer) return this.speedWindBuffer;
    if (!this.audioContext) return null;

    const sampleRate = this.audioContext.sampleRate;
    const length = speedWindLoopLength(sampleRate);
    const buffer = this.audioContext.createBuffer(2, length, sampleRate);
    // Decorrelated channels — a mono wind bed collapses to the centre and
    // fights the positional water layers for the same image.
    fillSpeedWindChannel(buffer.getChannelData(0), 0x5eed);
    fillSpeedWindChannel(buffer.getChannelData(1), 0xb1a5);

    this.speedWindBuffer = buffer;
    return buffer;
  }

  /**
   * Lowpass frequency for the wetness muffle, or null when dry enough that a
   * filter node is not worth inserting.
   */
  getWetnessCutoffHz(): number | null {
    const muffle = currentWetnessMuffle();
    return muffle.wet > 0.02 ? muffle.cutoffHz : null;
  }

  /**
   * Mute/unmute all audio
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.listener.setMasterVolume(muted ? 0 : this.masterVolume);
  }
  
  /**
   * Get load status for diagnostics overlay
   */
  getLoadStatus(): { loaded: number; total: number; failed: string[]; soundNames: string[] } {
    const soundNames = Object.keys(SOUND_DEFS);
    return {
      loaded: this.sounds.size,
      total: soundNames.length,
      failed: Array.from(this.failedSounds),
      soundNames,
    };
  }
  
  /**
   * Get currently playing sounds with elapsed time
   */
  getActiveSounds(): { name: string; elapsed: number }[] {
    const now = Date.now();
    const result: { name: string; elapsed: number }[] = [];
    this.activeSounds.forEach((sounds) => {
      sounds.forEach((s) => {
        result.push({
          name: s.name,
          elapsed: (now - s.startTime) / 1000,
        });
      });
    });
    return result;
  }
  
  /**
   * Get the Web Audio context state
   */
  getAudioContextState(): string {
    return this.audioContext?.state ?? 'unknown';
  }

  /**
   * Build a lightweight synthetic IR for canyon-like reverberation. Cached per
   * 50 ms of decay so re-routing a layer does not regenerate noise.
   */
  private syntheticImpulseResponse(decaySeconds: number): AudioBuffer | null {
    if (!this.audioContext) return null;
    const key = Math.round(decaySeconds * 20);
    const cached = this.impulseCache.get(key);
    if (cached) return cached;

    const sampleRate = this.audioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * (key / 20)));
    const buffer = this.audioContext.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const envelope = Math.pow(1 - t, 2.2);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
    }

    this.impulseCache.set(key, buffer);
    return buffer;
  }

  /**
   * Enable canyon acoustics for routed layers.
   *
   * @param wallTightness 0 (open) – 1 (slot), from the biome's TrackBiomeProfile.
   * @param wallWetness   0 (absorbent) – 1 (wet ice / concrete); see canyonAcoustics.ts.
   */
  enableCanyonAcoustics(wallTightness: number, wallWetness: number = DEFAULT_WALL_WETNESS): void {
    const tightness = Number.isFinite(wallTightness) ? Math.max(0, Math.min(1, wallTightness)) : 0;
    const wetness = Number.isFinite(wallWetness) ? Math.max(0, Math.min(1, wallWetness)) : DEFAULT_WALL_WETNESS;
    const state = this.canyonAcoustics;
    if (
      state.active &&
      Math.abs(state.wallTightness - tightness) < 1e-3 &&
      Math.abs(state.wallWetness - wetness) < 1e-3
    ) {
      return;
    }
    state.active = true;
    state.wallTightness = tightness;
    state.wallWetness = wetness;
    this.refreshAcousticRouting();
  }

  /**
   * Disable canyon acoustics.
   */
  disableCanyonAcoustics(): void {
    const wasActive = this.canyonAcoustics.active;
    this.canyonAcoustics.active = false;
    this.canyonAcoustics.wallTightness = 0;
    if (wasActive) this.refreshAcousticRouting();
  }

  /** Live wall tightness (0 when acoustics are off) — the speed-wind worklet reads it. */
  getCanyonWallTightness(): number {
    return this.canyonAcoustics.active ? this.canyonAcoustics.wallTightness : 0;
  }

  /**
   * Put a playing layer under canyon acoustics. It is re-routed automatically
   * whenever the walls change, until `unrouteAcoustics`.
   */
  routeAcoustics(source: RoutableAudio, stem: AcousticStem = 'bed'): void {
    this.routedSources.set(source, stem);
    this.applyCanyonFilters(source, stem);
  }

  /** Stop following canyon acoustics and strip the chain back to dry. */
  unrouteAcoustics(source: RoutableAudio): void {
    if (!this.routedSources.delete(source)) return;
    this.releaseSendNodes(source);
    try {
      source.setFilters([]);
    } catch {
      // Source already torn down — nothing left to strip.
    }
  }

  private refreshAcousticRouting(): void {
    for (const [source, stem] of this.routedSources) {
      try {
        this.applyCanyonFilters(source, stem);
      } catch (error) {
        console.warn('[AudioManager] Dropping acoustic route for a dead source:', error);
        this.routedSources.delete(source);
      }
    }
  }

  private releaseSendNodes(source: RoutableAudio): void {
    const nodes = this.sendNodes.get(source);
    if (!nodes) return;
    for (const node of nodes) node.disconnect();
    this.sendNodes.delete(source);
  }

  /**
   * Apply/clear the acoustic filter chain on a playing source.
   *
   * Two independent contributions, composed in one chain so a source is never
   * handed two competing `setFilters` calls: canyon acoustics (wall tightness
   * and surface) and the survival wetness muffle. Either can be absent.
   *
   * Canyon acoustics are sends around a unity dry path (canyonAcoustics.ts):
   *
   *   in ─ lowpass ─────────────────────────────── out ─ [wetness muffle]
   *    ├─ convolver ─ reverbSend ────────────────┘
   *    └─ ER lowpass ─ delay/tap ×N ─ erSend ────┘   (rapids stem only)
   *
   * `setFilters` wires the `in → lowpass → out` spine; the sends hang off it
   * and are tracked so a re-route can release them.
   */
  applyCanyonFilters(source: RoutableAudio, stem: AcousticStem = 'bed'): void {
    this.releaseSendNodes(source);
    const ctx = this.audioContext;
    if (!ctx) {
      source.setFilters([]);
      return;
    }

    const filters: AudioNode[] = [];
    const sends: AudioNode[] = [];

    if (this.canyonAcoustics.active) {
      const p = canyonAcousticParams(this.canyonAcoustics.wallTightness, this.canyonAcoustics.wallWetness);

      const input = ctx.createGain();
      const lowPass = ctx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.value = p.lowpassHz;
      lowPass.Q.value = p.lowpassQ;
      const output = ctx.createGain();
      filters.push(input, lowPass, output);

      const convolver = ctx.createConvolver();
      convolver.buffer = this.syntheticImpulseResponse(p.reverbDecaySeconds);
      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = p.reverbSend;
      input.connect(convolver);
      convolver.connect(reverbReturn);
      reverbReturn.connect(output);
      sends.push(convolver, reverbReturn);

      if (stem === 'rapids' && p.taps.length > 0) {
        const erFilter = ctx.createBiquadFilter();
        erFilter.type = 'lowpass';
        erFilter.frequency.value = p.earlyReflectionLowpassHz;
        const erReturn = ctx.createGain();
        erReturn.gain.value = p.earlyReflectionSend;
        input.connect(erFilter);
        for (const tap of p.taps) {
          const delay = ctx.createDelay(0.5);
          delay.delayTime.value = tap.delaySeconds;
          const tapGain = ctx.createGain();
          tapGain.gain.value = tap.gain;
          erFilter.connect(delay);
          delay.connect(tapGain);
          tapGain.connect(erReturn);
          sends.push(delay, tapGain);
        }
        erReturn.connect(output);
        sends.push(erFilter, erReturn);
      }
    }

    const wetnessCutoff = this.getWetnessCutoffHz();
    if (wetnessCutoff !== null) {
      const muffle = ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = wetnessCutoff;
      muffle.Q.value = 0.4;
      filters.push(muffle);
    }

    source.setFilters(filters);
    if (sends.length > 0) this.sendNodes.set(source, sends);
  }
  
  /**
   * Set reactive audio crossfade volumes (called by ReactiveAudio)
   */
  setReactiveVolumes(volumes: Partial<ReactiveVolumes>): void {
    this.reactiveVolumes = { ...this.reactiveVolumes, ...volumes };
  }
  
  /**
   * Get reactive audio crossfade volumes
   */
  getReactiveVolumes(): ReactiveVolumes {
    return { ...this.reactiveVolumes };
  }

  /**
   * Snapshot of reactive layers + canyon acoustic state for diagnostics.
   */
  getAudioState(): {
    layers: ReactiveVolumes;
    reverbActive: boolean;
    wallTightness: number;
    wallWetness: number;
    routedLayers: number;
  } {
    return {
      layers: this.getReactiveVolumes(),
      reverbActive: this.canyonAcoustics.active,
      wallTightness: this.canyonAcoustics.wallTightness,
      wallWetness: this.canyonAcoustics.wallWetness,
      routedLayers: this.routedSources.size,
    };
  }
  
  /**
   * Get material-specific collision sound
   */
  static getCollisionSound(material: string): string {
    const map: Record<string, string> = {
      'rock': 'collide_rock',
      'moss': 'collide_moss',
      'wood': 'collide_wood',
      'concrete': 'collide_concrete',
      'water': 'collide_water',
    };
    return map[material] || 'collide_rock';
  }
  
  /**
   * Get footstep sound for material
   */
  static getFootstepSound(material: string, isWet: boolean): string {
    if (isWet) return 'step_wet';
    return `step_${material}` || 'step_rock';
  }
  
  /**
   * Dispose all audio resources
   */
  dispose(): void {
    this.activeSounds.forEach((sounds, name) => {
      sounds.forEach(s => s.source.stop());
    });
    this.activeSounds.clear();
    
    this.ambientTrack?.stop();
    this.ambientTrack = null;

    this.unlockGate.dispose();
    this.routedSources.clear();
    this.impulseCache.clear();
    this.sounds.clear();
    this.fileLoads.clear();
    this.speedWindBuffer = null;
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
