import { useState } from 'react';
import { SHED } from '../constants';
import { ParticlePool } from '../../../components/particlePool';
import { COLLISION_PARTICLE_CAPACITY } from '../../../components/CollisionParticles';
import { createRaftPhysicsState, type RaftPhysicsState } from '../raftPhysicsState';

/** Paddle foam: a few per stroke, 1 s each. */
const FOAM_PARTICLE_CAPACITY = 48;

export interface RaftMountState {
  /** The step's state (SimCore's `vehicle-raft` writes it; the host only reads it). */
  physics: RaftPhysicsState;
  /** Stepped and drawn by ParticlePoolMesh; the physics step only spawns into them. */
  foamParticles: ParticlePool;
  shedParticles: ParticlePool;
  /** Collision bursts (raftCues spawns them on `vehicle-impact`). */
  collisionParticles: ParticlePool;
}

/** One raft mount's state. Lazy `useState`: built once per mount, never per render. */
export function useRaftPhysicsState(): RaftMountState {
  const [state] = useState<RaftMountState>(() => ({
    physics: createRaftPhysicsState(),
    foamParticles: new ParticlePool(FOAM_PARTICLE_CAPACITY),
    shedParticles: new ParticlePool(SHED.COUNT_LIMIT),
    collisionParticles: new ParticlePool(COLLISION_PARTICLE_CAPACITY),
  }));
  return state;
}
