/**
 * runnerCues.ts — the runner's presentation, fed by its physics step's cues (#556 A).
 *
 * The step emits `vehicle-*` events on `gameEvents` and calls nothing that
 * makes a sound, moves the camera or spawns a particle. RunnerVehicle (the R3F
 * host) subscribes here for its mount: sounds, the camera shake (with its
 * haptic pulse) and the collision bursts. A headless run subscribes nothing.
 *
 * Listeners run synchronously inside the step, in the order the step emits,
 * so the audio and particle streams draw exactly as they did when the step
 * called them inline.
 */
import { gameEvents } from '../../systems/events/GameEvents';
import { triggerCameraShake } from '../../hooks/useCameraShake';
import { emitCollisionBurst } from '../../components/CollisionParticles';
import type { ParticlePool } from '../../components/particlePool';
import { playDodgeSound, playFootstep, playJumpSound, playLandSound } from './audio';

/** Default shake length when a cue gives none (triggerCameraShake's own default). */
const DEFAULT_SHAKE_SEC = 0.3;

/** Subscribe the runner's presentation; returns the unsubscribe. */
export function subscribeRunnerCues(particles: ParticlePool): () => void {
  const offs = [
    gameEvents.on('vehicle-jump', ({ speed, double }) => playJumpSound(speed, double)),
    gameEvents.on('vehicle-land', ({ impactSpeed }) => playLandSound(impactSpeed)),
    gameEvents.on('vehicle-footstep', ({ material, wet }) => playFootstep(material, wet)),
    gameEvents.on('vehicle-dodge', () => playDodgeSound()),
    gameEvents.on('vehicle-shake', ({ vehicle, intensity, duration }) => {
      if (vehicle === 'runner') triggerCameraShake(intensity, duration ?? DEFAULT_SHAKE_SEC);
    }),
    gameEvents.on('vehicle-impact', ({ vehicle, material, point, intensity }) => {
      if (vehicle === 'runner') emitCollisionBurst(particles, material, point, intensity);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
