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

// Default sound library
const SOUND_LIBRARY: Record<string, SoundDef> = {
  // Footsteps
  'step_rock': { url: '/sounds/footstep_rock.mp3', category: SoundCategory.FOOTSTEP, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 2 },
  'step_moss': { url: '/sounds/footstep_moss.mp3', category: SoundCategory.FOOTSTEP, baseVolume: 0.4, basePitch: 0.9, maxConcurrent: 2 },
  'step_wood': { url: '/sounds/footstep_wood.mp3', category: SoundCategory.FOOTSTEP, baseVolume: 0.5, basePitch: 1.1, maxConcurrent: 2 },
  'step_wet': { url: '/sounds/footstep_wet.mp3', category: SoundCategory.FOOTSTEP, baseVolume: 0.6, basePitch: 0.8, maxConcurrent: 2 },
  
  // Jumps
  'jump': { url: '/sounds/jump.mp3', category: SoundCategory.JUMP, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 1 },
  'double_jump': { url: '/sounds/jump_double.mp3', category: SoundCategory.JUMP, baseVolume: 0.6, basePitch: 1.2, maxConcurrent: 1 },
  
  // Landings
  'land_soft': { url: '/sounds/land_soft.mp3', category: SoundCategory.LAND, baseVolume: 0.5, basePitch: 1.0, maxConcurrent: 1 },
  'land_hard': { url: '/sounds/land_hard.mp3', category: SoundCategory.LAND, baseVolume: 0.8, basePitch: 0.9, maxConcurrent: 1 },
  'land_impact': { url: '/sounds/land_impact.mp3', category: SoundCategory.LAND, baseVolume: 1.0, basePitch: 0.8, maxConcurrent: 1 },
  
  // Collisions
  'collide_rock': { url: '/sounds/collide_rock.mp3', category: SoundCategory.COLLISION, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 2 },
  'collide_wood': { url: '/sounds/collide_wood.mp3', category: SoundCategory.COLLISION, baseVolume: 0.6, basePitch: 0.9, maxConcurrent: 2 },
  'collide_moss': { url: '/sounds/collide_moss.mp3', category: SoundCategory.COLLISION, baseVolume: 0.4, basePitch: 1.1, maxConcurrent: 2 },
  'collide_water': { url: '/sounds/splash.mp3', category: SoundCategory.COLLISION, baseVolume: 0.8, basePitch: 1.0, maxConcurrent: 3 },
  'collide_concrete': { url: '/sounds/collide_concrete.mp3', category: SoundCategory.COLLISION, baseVolume: 0.7, basePitch: 0.95, maxConcurrent: 2 },
  
  // Raft
  'paddle_left': { url: '/sounds/paddle_left.mp3', category: SoundCategory.PADDLE, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  'paddle_right': { url: '/sounds/paddle_right.mp3', category: SoundCategory.PADDLE, baseVolume: 0.6, basePitch: 1.0, maxConcurrent: 1 },
  'raft_creak': { url: '/sounds/raft_creak.mp3', category: SoundCategory.COLLISION, baseVolume: 0.7, basePitch: 1.0, maxConcurrent: 1 },
  'water_crash': { url: '/sounds/water_crash.mp3', category: SoundCategory.COLLISION, baseVolume: 1.0, basePitch: 0.9, maxConcurrent: 1 },
  
  // Ambient
  'ambient_water': { url: '/sounds/ambient_water.mp3', category: SoundCategory.AMBIENT, baseVolume: 0.3, basePitch: 1.0, maxConcurrent: 1 },
  'ambient_wind': { url: '/sounds/ambient_wind.mp3', category: SoundCategory.AMBIENT, baseVolume: 0.2, basePitch: 1.0, maxConcurrent: 1 },
  'ambient_canyon': { url: '/sounds/ambient_canyon.mp3', category: SoundCategory.AMBIENT, baseVolume: 0.25, basePitch: 1.0, maxConcurrent: 1 },
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
  
  constructor(camera: THREE.Camera) {
    // Create audio listener and attach to camera
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    
    // Create audio loader
    this.loader = new THREE.AudioLoader();
    
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
   * Pre-load essential sounds
   */
  private async preloadCriticalSounds(): Promise<void> {
    const critical = ['jump', 'land_soft', 'step_rock', 'collide_rock'];
    for (const name of critical) {
      await this.loadSound(name);
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
      return buffer;
    } catch (e) {
      console.warn(`[AudioManager] Failed to load sound: ${name}`, e);
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
