/**
 * raftPhysicsState.ts — one raft's step state, as plain objects (#577 A.1).
 *
 * The raft's buoyancy, tipping, paddle, stamina, stun and momentum state used to
 * be React refs (`useRaftPhysicsState`). SimCore's `vehicle-raft` owns it now,
 * so a headless run builds the same state with no React; the host keeps a
 * reference only to read it (nothing outside the step writes it). The `{ current }`
 * boxes are kept: the runtime and its tests address the state through them.
 */
import * as THREE from 'three';
import {
  STAMINA,
  type BuoyancyState, type PaddleState, type StaminaState, type StunState, type TippingState,
} from './constants';

export interface RaftPhysicsState {
  buoyancyState: { current: BuoyancyState };
  tippingState: { current: TippingState };
  paddleState: { current: PaddleState };
  staminaState: { current: StaminaState };
  stunState: { current: StunState };
  /** Seconds of the last stroke's forward bias left. */
  forwardBiasState: { current: number };
  /** The body's velocity at the end of the last step (impact detection). */
  prevVelocity: THREE.Vector3;
  /** Raft seconds since the run started (the turbulence phase). */
  time: number;
  /** Seconds since the last stern-spray particle. */
  shedTimer: number;
}

export function createRaftPhysicsState(): RaftPhysicsState {
  return resetRaftPhysicsState({
    buoyancyState: { current: { submergedRatio: 0, buoyancyForce: 0, isFloating: false } },
    tippingState: {
      current: { rollAngle: 0, pitchAngle: 0, dangerTime: 0, isTipped: false, lastSafePosition: new THREE.Vector3() },
    },
    paddleState: { current: { leftPaddle: false, rightPaddle: false } },
    staminaState: { current: { current: STAMINA.MAX, regenDelay: 0, isExhausted: false } },
    stunState: { current: { active: false, timer: 0 } },
    forwardBiasState: { current: 0 },
    prevVelocity: new THREE.Vector3(),
    time: 0,
    shedTimer: 0,
  });
}

/**
 * Back to a fresh raft's state, in place (a run reset). The last safe position
 * is kept: it is where a tip puts the raft back, and the respawn sets the body.
 */
export function resetRaftPhysicsState(s: RaftPhysicsState): RaftPhysicsState {
  const b = s.buoyancyState.current;
  b.submergedRatio = 0;
  b.buoyancyForce = 0;
  b.isFloating = false;
  const t = s.tippingState.current;
  t.rollAngle = 0;
  t.pitchAngle = 0;
  t.dangerTime = 0;
  t.isTipped = false;
  s.paddleState.current.leftPaddle = false;
  s.paddleState.current.rightPaddle = false;
  const st = s.staminaState.current;
  st.current = STAMINA.MAX;
  st.regenDelay = 0;
  st.isExhausted = false;
  s.stunState.current.active = false;
  s.stunState.current.timer = 0;
  s.forwardBiasState.current = 0;
  s.prevVelocity.set(0, 0, 0);
  s.time = 0;
  s.shedTimer = 0;
  return s;
}
