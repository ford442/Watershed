import { getAudioManager, AudioManager } from '../../systems/AudioSystem';

let audioManager: AudioManager | null = null;

const initAudio = () => {
  if (!audioManager) {
    audioManager = getAudioManager();
  }
};

export const playPaddleSound = (side: 'left' | 'right') => {
  initAudio();
  if (!audioManager) return;

  const sound = side === 'left' ? 'paddle_left' : 'paddle_right';
  const pitch = 0.95 + Math.random() * 0.1;
  audioManager.playSound(sound, 0.8, pitch);
};

export const playSplashSound = (intensity: number) => {
  initAudio();
  if (!audioManager) return;

  const volume = Math.max(0.2, Math.min(1.0, intensity));
  const pitch = 0.9 + Math.random() * 0.2;
  audioManager.playSound('water_splash', volume, pitch);
};

export const playCollisionSound = (material: string, impactForce: number) => {
  initAudio();
  if (!audioManager) return;

  let soundName = 'land_impact'; // Default hard collision
  let volume = Math.min(1.0, impactForce / 15);
  let pitch = 1.0;

  if (material === 'debris') {
    soundName = 'impact_wood';
    volume = Math.min(0.8, impactForce / 10);
    pitch = 0.8 + Math.random() * 0.4;
  } else if (material === 'flesh') {
    soundName = 'land_soft';
    volume = Math.min(0.6, impactForce / 10);
  }

  audioManager.playSound(soundName, volume, pitch);
};

export const playRaftTipSound = () => {
  initAudio();
  if (!audioManager) return;
  audioManager.playSound('raft_tip', 0.9, 0.85);
};

export const updateWaterRushingSound = (speed: number) => {
  initAudio();
  if (!audioManager) return;

  // Simple dynamic volume based on raft speed
  const targetVolume = Math.min(0.8, Math.max(0, (speed - 5) / 20));
  // Could implement crossfading or parameter updating if AudioManager supports it
};
