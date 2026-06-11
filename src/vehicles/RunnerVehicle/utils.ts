// Camera shake effect
export const triggerCameraShake = (intensity: number, duration: number = 0.3) => {
  window.dispatchEvent(new CustomEvent('camera-shake', {
    detail: { intensity, duration }
  }));
};
