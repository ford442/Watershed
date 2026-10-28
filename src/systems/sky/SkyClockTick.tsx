/**
 * SkyClockTick — places the sun for the run's sky clock.
 *
 * Null component mounted once inside the Canvas (and the SunPositionProvider).
 * The clock itself is stepped by SimCore (`skySimSystem.ts`, order 20, at −90).
 * Each frame this writes the sun's direction and a point `SUN_DISTANCE` toward
 * it from the camera into the shared sun refs, before any default-priority
 * reader (sky, lights, water, post) runs.
 */
import { useFrame } from '@react-three/fiber';
import { SUN_DISTANCE, useSunPosition } from '../lighting/SunPositionSystem';
import { getSkyClock } from './skyClock';

export const SKY_CLOCK_PRIORITY = -85;

export function SkyClockTick(): null {
  const { sunDirection, sunWorldPosition } = useSunPosition();

  useFrame((state) => {
    const { sun } = getSkyClock();
    sunDirection.set(sun.x, sun.y, sun.z);
    sunWorldPosition.copy(state.camera.position).addScaledVector(sunDirection, SUN_DISTANCE);
  }, SKY_CLOCK_PRIORITY);

  return null;
}

export default SkyClockTick;
