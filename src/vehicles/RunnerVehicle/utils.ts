import { pulse } from '../../input/haptics';
import { gameEvents } from '../../systems/events/GameEvents';

// Camera shake effect; impacts also provide feedback to the active gamepad.
export const triggerCameraShake = (intensity: number, duration: number = 0.3) => {
  pulse('impact', Math.min(1, intensity * 1.8));
  gameEvents.emit('camera-shake', { intensity, duration });
};
