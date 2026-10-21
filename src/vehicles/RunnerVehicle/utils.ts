import { gameEvents } from '../../systems/events/GameEvents';

// Camera shake effect
export const triggerCameraShake = (intensity: number, duration: number = 0.3) => {
  gameEvents.emit('camera-shake', { intensity, duration });
};
