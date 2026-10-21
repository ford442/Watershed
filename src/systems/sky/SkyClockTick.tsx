/**
 * SkyClockTick — advances the run's sky clock and places the sun.
 *
 * Null component mounted once inside the Canvas (and the SunPositionProvider).
 * Each unpaused frame it adds the frame's sim delta to the clock, then writes
 * the sun's direction and a point `SUN_DISTANCE` toward it from the camera
 * into the shared sun refs, before any default-priority reader (sky, lights,
 * water, post) runs.
 */
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../GameState';
import { SUN_DISTANCE, useSunPosition } from '../lighting/SunPositionSystem';
import { getSkyClock, tickSkyClock } from './skyClock';

export const SKY_CLOCK_PRIORITY = -85;

export function SkyClockTick(): null {
  const { sunDirection, sunWorldPosition } = useSunPosition();

  useFrame((state, delta) => {
    if (!useGameStore.getState().isPaused) tickSkyClock(delta);
    const { sun } = getSkyClock();
    sunDirection.set(sun.x, sun.y, sun.z);
    sunWorldPosition.copy(state.camera.position).addScaledVector(sunDirection, SUN_DISTANCE);
  }, SKY_CLOCK_PRIORITY);

  return null;
}

export default SkyClockTick;
