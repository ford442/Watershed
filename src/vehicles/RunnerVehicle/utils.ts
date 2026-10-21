import { pulse } from '../../input/haptics';

// Camera shake effect. Every caller is an impact (wall hit, landing, raft
// collision), so it doubles as the gamepad's impact rumble (#486 B).
export const triggerCameraShake = (intensity: number, duration: number = 0.3) => {
  pulse('impact', Math.min(1, intensity * 1.8));
  window.dispatchEvent(new CustomEvent('camera-shake', {
    detail: { intensity, duration }
  }));
};
