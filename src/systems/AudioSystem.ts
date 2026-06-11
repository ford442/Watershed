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

// Sound categories for organization and limiting
export enum SoundCategory {
  FOOTSTEP = 'footstep',
  JUMP = 'jump',
  LAND = 'land',
  COLLISION = 'collision',
  PADDLE = 'paddle',
  AMBIENT = 'ambient',
  UI = 'ui',
}

// Sound definition
interface SoundDef {
  url: string;
  category: SoundCategory;
  baseVolume: number;
  basePitch: number;
  maxConcurrent: number;
}

// Active sound tracking
interface ActiveSound {
  name: string;
  source: THREE.Audio | THREE.PositionalAudio;
  startTime: number;
}

interface ReactiveVolumes {
  low: number;
  mid: number;
  high: number;
  rapids: number;
  whoosh: number;
  transition: number;
}

// Default sound library
const BASE_SOUND_URL = import.meta.env.BASE_URL || '/';

const SOUND_LIBRARY: Record<string, SoundDef> = {
  // Footsteps
  'step_rock': { url: `${BASE_SOUND_URL}sounds/footstep_rock.mp3`, category: SoundCategory.FOOTSTEP, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 2 },
  'step_moss': { url: `${BASE_SOUND_URL}sounds/footstep_moss.mp3`, category: SoundCategory.FOOTSTEP, baseVolume: 0.4, basePitch: 0.9, maxConcurrent: 2 },
  'step_wood': { url: `${BASE_SOUND_URL}sounds/footstep_wood.mp3`, category: SoundCategory.FOOTSTEP, baseVolume: 0.5, basePitch: 1.1, maxConcurrent: 2 },
  'step_wet': { url: `${BASE_SOUND_URL}sounds/footstep_wet.mp3`, category: SoundCategory.FOOTSTEP, baseVolume: 0.6, basePitch: 0.8, maxConcurrent: 2 },

  // Jumps
  'jump': { url: `${BASE_SOUND_URL}sounds/jump.mp3`, category: SoundCategory.JUMP, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 1 },
  'double_jump': { url: `${BASE_SOUND_URL}sounds/jump_double.mp3`, category: SoundCategory.JUMP, baseVolume: 0.6, basePitch: 1.2, maxConcurrent: 1 },

  // Landings
  'land_soft': { url: `${BASE_SOUND_URL}sounds/land_soft.mp3`, category: SoundCategory.LAND, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 1 },
  'land_hard': { url: `${BASE_SOUND_URL}sounds/land_hard.mp3`, category: SoundCategory.LAND, baseVolume: 0.8, basePitch: 0.9, maxConcurrent: 1 },
  'land_impact': { url: `${BASE_SOUND_URL}sounds/land_impact.mp3`, category: SoundCategory.LAND, baseVolume: 1.0, basePitch: 0.8, maxConcurrent: 1 },

  // Collisions
  'collide_rock': { url: `${BASE_SOUND_URL}sounds/collide_rock.mp3`, category: SoundCategory.COLLISION, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 2 },
  'collide_wood': { url: `${BASE_SOUND_URL}sounds/collide_wood.mp3`, category: SoundCategory.COLLISION, baseVolume: 0.6, basePitch: 0.9, maxConcurrent: 2 },
  'collide_moss': { url: `${BASE_SOUND_URL}sounds/collide_moss.mp3`, category: SoundCategory.COLLISION, baseVolume: 0.4, basePitch: 1.1, maxConcurrent: 2 },
  'collide_water': { url: `${BASE_SOUND_URL}sounds/splash.mp3`, category: SoundCategory.COLLISION, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 3 },
  'collide_concrete': { url: `${BASE_SOUND_URL}sounds/collide_concrete.mp3`, category: SoundCategory.COLLISION, baseVolume: 0.7, basePitch: 0.95, maxConcurrent: 2 },

  // Raft
  'paddle_left': { url: `${BASE_SOUND_URL}sounds/paddle_left.mp3`, category: SoundCategory.PADDLE, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  'paddle_right': { url: `${BASE_SOUND_URL}sounds/paddle_right.mp3`, category: SoundCategory.PADDLE, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  'raft_creak': { url: `${BASE_SOUND_URL}sounds/raft_creak.mp3`, category: SoundCategory.COLLISION, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 1 },
  'water_crash': { url: `${BASE_SOUND_URL}sounds/water_crash.mp3`, category: SoundCategory.COLLISION, baseVolume: 1.0, basePitch: 0.9, maxConcurrent: 1 },

  // Vehicle tuning — boost
  'boost': { url: `${BASE_SOUND_URL}sounds/boost.mp3`, category: SoundCategory.UI, baseVolume: 0.9, basePitch: 1.0, maxConcurrent: 1 },

  // Goal 2: Dodge / dash (mapped to an existing sound to avoid 404; load gracefully)
  'dodge': { url: `${BASE_SOUND_URL}sounds/boost.mp3`, category: SoundCategory.UI, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 2 },

  // Water flow — rapids ambience
  'rapids_roar': { url: `${BASE_SOUND_URL}sounds/rapids_roar.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 1 },

  // Layered water stems (fallback-friendly names; can be swapped for bespoke assets later)
  'water_close_gurgle': { url: `${BASE_SOUND_URL}sounds/ambient_water.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  'water_mid_rapids': { url: `${BASE_SOUND_URL}sounds/rapids_roar.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 1 },
  'water_distant_roar': { url: `${BASE_SOUND_URL}sounds/ambient_canyon.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.4, basePitch: 1.0, maxConcurrent: 1 },
  'water_whoosh': { url: `${BASE_SOUND_URL}sounds/ambient_wind.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.0, basePitch: 1.0, maxConcurrent: 1 },

  // Ambient
  'ambient_water': { url: `${BASE_SOUND_URL}sounds/ambient_water.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.3, basePitch: 1.0, maxConcurrent: 1 },
  'ambient_wind': { url: `${BASE_SOUND_URL}sounds/ambient_wind.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.2, basePitch: 1.0, maxConcurrent: 1 },
  'ambient_canyon': { url: `${BASE_SOUND_URL}sounds/ambient_canyon.mp3`, category: SoundCategory.AMBIENT, baseVolume: 0.25, basePitch: 1.0, maxConcurrent: 1 },
};

// Fallback sound URLs (will be synthesized if files don't exist)
const FALLBACK_URLS: Record<string, string> = {};

export class AudioManager {
  private listener: THREE.AudioListener;
  private loader: THREE.AudioLoader;
  private audioContext: AudioContext | null = null;
  private sounds: Map<string, THREE.AudioBuffer> = new Map();
  private activeSounds: Map<string, ActiveSound[]> = new Map();
  private ambientTrack: THREE.Audio | null = null;
  private isMuted: boolean = false;
  private masterVolume: number = 1.0;
  
  // Category limits tracking
  private categoryCounts: Map<SoundCategory, number> = new Map();
  
  // Load status tracking
  private failedSounds: Set<string> = new Set();
  
  // Reactive audio volumes (populated by ReactiveAudio if mounted)
  private reactiveVolumes: ReactiveVolumes = { low: 0, mid: 0, high: 0, rapids: 0, whoosh: 0, transition: 0 };

  // Canyon acoustic state
  private canyonAcoustics = {
    active: false,
    wallTightness: 0,
  };
  
  constructor(camera: THREE.Camera) {
    // Create audio listener and attach to camera
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    
    // Create audio loader
    this.loader = new THREE.AudioLoader();
    
    // Cache the underlying Web Audio context for introspection
    this.audioContext = this.listener.context as AudioContext;
    
    // Initialize category counts
    Object.values(SoundCategory).forEach(cat => {
      this.categoryCounts.set(cat, 0);
    });
    
    // Pre-load critical sounds
    this.preloadCriticalSounds();
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
   * Pre-load essential sounds (fire-and-forget so one failure doesn't stall init)
   */
  private preloadCriticalSounds(): void {
    const critical = ['jump', 'land_soft', 'step_rock', 'collide_rock'];
    for (const name of critical) {
      this.loadSound(name).catch(() => {
        // Warning already logged inside loadSound
      });
    }
  }
  
  /**
   * Load a sound file into memory
   */
  async loadSound(name: string): Promise<THREE.AudioBuffer | null> {
    if (this.sounds.has(name)) {
      return this.sounds.get(name)!;
    }
    
    const def = SOUND_LIBRARY[name];
    if (!def) {
      console.warn(`[AudioManager] Sound not found: ${name}`);
      return null;
    }
    
    try {
      const buffer = await this.loader.loadAsync(def.url);
      this.sounds.set(name, buffer);
      this.failedSounds.delete(name);
      return buffer;
    } catch (e) {
      console.warn(`[AudioManager] Failed to load sound: ${name}`, e);
      this.failedSounds.add(name);
      return null;
    }
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
    
    const def = SOUND_LIBRARY[name];
    if (!def) {
      console.warn(`[AudioManager] Unknown sound: ${name}`);
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
      // Try to load on-demand
      this.loadSound(name).then(() => {
        this.playSound(name, volume, pitch, position);
      });
      return null;
    }
    
    // Create audio source
    let source: THREE.Audio | THREE.PositionalAudio;
    if (position) {
      source = new THREE.PositionalAudio(this.listener);
      source.position.copy(position);
      source.setRefDistance(10);
      source.setRolloffFactor(1);
      source.setDistanceModel('inverse');
    } else {
      source = new THREE.Audio(this.listener);
    }
    
    // Set buffer
    source.setBuffer(buffer);
    
    // Apply parametric controls
    const finalVolume = Math.max(0, Math.min(1, volume * def.baseVolume * this.masterVolume));
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
      const def = SOUND_LIBRARY[name];
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
      const def = SOUND_LIBRARY[name];
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
    // Fade out current ambient
    if (this.ambientTrack) {
      const oldTrack = this.ambientTrack;
      const startVol = oldTrack.getVolume();
      const fadeStart = Date.now();
      
      const fadeOut = () => {
        const elapsed = Date.now() - fadeStart;
        const t = Math.min(1, elapsed / fadeDuration);
        oldTrack.setVolume(startVol * (1 - t));
        
        if (t < 1) {
          requestAnimationFrame(fadeOut);
        } else {
          oldTrack.stop();
        }
      };
      fadeOut();
    }
    
    // Load and fade in new track
    this.loadSound(trackName).then(buffer => {
      if (!buffer) return;
      
      this.ambientTrack = new THREE.Audio(this.listener);
      this.ambientTrack.setBuffer(buffer);
      this.ambientTrack.setLoop(true);
      this.ambientTrack.setVolume(0);
      
      const def = SOUND_LIBRARY[trackName];
      const targetVol = (def?.baseVolume || 0.3) * this.masterVolume;
      const fadeStart = Date.now();
      
      const fadeIn = () => {
        const elapsed = Date.now() - fadeStart;
        const t = Math.min(1, elapsed / fadeDuration);
        this.ambientTrack?.setVolume(targetVol * t);
        
        if (t < 1) {
          requestAnimationFrame(fadeIn);
        }
      };
      
      this.ambientTrack.play();
      fadeIn();
    });
  }
  
  /**
   * Set master volume
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.listener.setMasterVolume(this.masterVolume);
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
    const soundNames = Object.keys(SOUND_LIBRARY);
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
   * Build a lightweight synthetic IR for canyon-like reverberation.
   */
  private syntheticImpulseResponse(decaySeconds: number): AudioBuffer | null {
    if (!this.audioContext) return null;
    const sampleRate = this.audioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * decaySeconds));
    const buffer = this.audioContext.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const envelope = Math.pow(1 - t, 2.2);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
    }

    return buffer;
  }

  /**
   * Enable canyon acoustics for reactive layers.
   */
  enableCanyonAcoustics(wallTightness: number): void {
    this.canyonAcoustics.active = true;
    this.canyonAcoustics.wallTightness = Math.max(0, Math.min(1, wallTightness));
  }

  /**
   * Disable canyon acoustics.
   */
  disableCanyonAcoustics(): void {
    this.canyonAcoustics.active = false;
    this.canyonAcoustics.wallTightness = 0;
  }

  /**
   * Apply/clear acoustic filter chain on a playing source.
   */
  applyCanyonFilters(source: THREE.Audio | THREE.PositionalAudio): void {
    if (!this.audioContext || !this.canyonAcoustics.active) {
      source.setFilters([]);
      return;
    }

    const wallTightness = this.canyonAcoustics.wallTightness;
    const lowPass = this.audioContext.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 6000 - wallTightness * 2000;
    lowPass.Q.value = 0.5 + wallTightness * 2.0;

    const convolver = this.audioContext.createConvolver();
    const decay = 0.3 + wallTightness * 0.5;
    convolver.buffer = this.syntheticImpulseResponse(decay);

    source.setFilters([lowPass, convolver]);
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
  getAudioState(): { layers: ReactiveVolumes; reverbActive: boolean; wallTightness: number } {
    return {
      layers: this.getReactiveVolumes(),
      reverbActive: this.canyonAcoustics.active,
      wallTightness: this.canyonAcoustics.wallTightness,
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
    
    this.sounds.clear();
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
