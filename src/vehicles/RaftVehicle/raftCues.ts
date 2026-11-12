/**
 * raftCues.ts — the raft's sounds, shake and collision bursts, fed by its step's cues (#556 A).
 *
 * The raft step emits `raft-*` / `vehicle-*` events and calls no audio or
 * camera code; RaftVehicle subscribes here for its mount. Listeners run
 * synchronously in emit order, so the raft audio stream (`random()` in
 * audio.ts) draws exactly as it did when the step called it inline.
 */
import { gameEvents } from '../../systems/events/GameEvents';
import { triggerCameraShake } from '../../hooks/useCameraShake';
import { emitCollisionBurst } from '../../components/CollisionParticles';
import type { ParticlePool } from '../../components/particlePool';
import { playPaddleSound, playRaftTipSound, playSplashSound } from './audio';

const DEFAULT_SHAKE_SEC = 0.3;

/** Subscribe the raft's presentation; returns the unsubscribe. */
export function subscribeRaftCues(particles: ParticlePool): () => void {
  const offs = [
    gameEvents.on('raft-paddle', ({ side }) => playPaddleSound(side)),
    gameEvents.on('raft-splash', ({ intensity }) => playSplashSound(intensity)),
    gameEvents.on('raft-tip', () => playRaftTipSound()),
    gameEvents.on('vehicle-shake', ({ vehicle, intensity, duration }) => {
      if (vehicle === 'raft') triggerCameraShake(intensity, duration ?? DEFAULT_SHAKE_SEC);
    }),
    gameEvents.on('vehicle-impact', ({ vehicle, material, point, intensity }) => {
      if (vehicle === 'raft') emitCollisionBurst(particles, material, point, intensity);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
