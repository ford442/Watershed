import { getAudioManager, AudioManager } from '../../systems/AudioSystem';

// Audio manager reference
let audioManager: AudioManager | null = null;

// Initialize audio on first interaction
export const initAudio = () => {
  if (!audioManager) {
    // Will be initialized by Experience component
    audioManager = getAudioManager();
  }
};

// Sound helpers
export const playJumpSound = (velocity: number, isDouble: boolean = false) => {
  initAudio();
  if (!audioManager) return;

  // Pitch scales with velocity: 0.8-1.2x
  const pitch = 0.8 + Math.min(0.4, velocity / 50);
  const sound = isDouble ? 'double_jump' : 'jump';
  audioManager.playSound(sound, 1.0, pitch);
};

export const playLandSound = (impactForce: number) => {
  initAudio();
  if (!audioManager) return;

  // Volume scales with force, select sound based on intensity
  let sound = 'land_soft';
  let volume = 0.5;

  if (impactForce > 10) {
    sound = 'land_impact';
    volume = Math.min(1.0, impactForce / 15);
  } else if (impactForce > 5) {
    sound = 'land_hard';
    volume = 0.7;
  }

  audioManager.playSound(sound, volume, 1.0);
};

export const playFootstep = (material: string, isWet: boolean) => {
  initAudio();
  if (!audioManager) return;

  const sound = AudioManager.getFootstepSound(material, isWet);
  // Muffled if wet (lower pitch), crisper if dry
  const pitch = isWet ? 0.85 : 1.0;
  const volume = isWet ? 0.6 : 0.5;

  audioManager.playSound(sound, volume, pitch);
};

export const playDodgeSound = () => {
  initAudio();
  if (!audioManager) return;
  audioManager.playSound('dodge', 0.8, 1.0);
};
