/** The runner's presentation listens to its step's cues (#556 A). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameEvents } from '../../systems/events/GameEvents';
import { ParticlePool } from '../../components/particlePool';
import { SurfaceMaterial } from '../../systems/vehicle/VehicleSystem';

const audio = vi.hoisted(() => ({
  playJumpSound: vi.fn(),
  playLandSound: vi.fn(),
  playFootstep: vi.fn(),
  playDodgeSound: vi.fn(),
}));
vi.mock('./audio', () => audio);
const shake = vi.hoisted(() => ({ triggerCameraShake: vi.fn() }));
vi.mock('../../hooks/useCameraShake', () => shake);

import { subscribeRunnerCues } from './runnerCues';

afterEach(() => {
  gameEvents.clear();
  vi.clearAllMocks();
});

describe('subscribeRunnerCues', () => {
  it('routes each cue to its sound, the shake and the burst — and stops on unsubscribe', () => {
    const pool = new ParticlePool(64);
    const off = subscribeRunnerCues(pool);

    gameEvents.emit('vehicle-jump', { speed: 12, double: true });
    gameEvents.emit('vehicle-land', { impactSpeed: 9 });
    gameEvents.emit('vehicle-footstep', { material: 'moss', wet: true });
    gameEvents.emit('vehicle-dodge', undefined);
    gameEvents.emit('vehicle-shake', { vehicle: 'runner', intensity: 0.4 });
    gameEvents.emit('vehicle-shake', { vehicle: 'raft', intensity: 0.9, duration: 1 });
    gameEvents.emit('vehicle-impact', {
      vehicle: 'runner', material: SurfaceMaterial.ROCK, point: { x: 0, y: 0, z: 0 }, intensity: 1,
    });

    expect(audio.playJumpSound).toHaveBeenCalledWith(12, true);
    expect(audio.playLandSound).toHaveBeenCalledWith(9);
    expect(audio.playFootstep).toHaveBeenCalledWith('moss', true);
    expect(audio.playDodgeSound).toHaveBeenCalledTimes(1);
    // The raft's shake is the raft host's.
    expect(shake.triggerCameraShake).toHaveBeenCalledTimes(1);
    expect(shake.triggerCameraShake).toHaveBeenCalledWith(0.4, 0.3);
    expect(pool.count).toBeGreaterThan(0);

    off();
    gameEvents.emit('vehicle-jump', { speed: 1, double: false });
    expect(audio.playJumpSound).toHaveBeenCalledTimes(1);
  });
});
