/**
 * raftPhysicsRuntime tipping (#503 F): danger tilt held past DANGER_TIME tips
 * the raft; resetRaft parks it upright on the last safe position (never below
 * the reset height), zeroes its motion and clears the danger state. Runs on a
 * stub RapierBody (#503 D) — no Rapier WASM.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRaftPhysicsRuntime, type RaftPhysicsRuntimeDeps } from './raftPhysicsRuntime';
import { STAMINA, TIPPING, type TippingState } from '../constants';
import { WATER_PHYSICS } from '../../../constants/waterPhysics';
import { ParticlePool } from '../../../components/particlePool';
import type { QuatLike, RapierBody, Vec3Like } from '../../../physics/rapierTypes';

class StubRaft implements RapierBody {
  readonly handle = 3;
  pos: Vec3Like = { x: 4, y: 0, z: -40 };
  rot: QuatLike = { x: 0, y: 0, z: 0, w: 1 };
  vel: Vec3Like = { x: 1, y: 0, z: -6 };
  ang: Vec3Like = { x: 0.5, y: 0.2, z: 0.1 };
  translation() { return { ...this.pos }; }
  rotation() { return { ...this.rot }; }
  linvel() { return { ...this.vel }; }
  angvel() { return { ...this.ang }; }
  setTranslation(t: Vec3Like) { this.pos = { ...t }; }
  setRotation(q: QuatLike) { this.rot = { ...q }; }
  setLinvel(v: Vec3Like) { this.vel = { ...v }; }
  setAngvel(v: Vec3Like) { this.ang = { ...v }; }
  applyImpulse() {}
  applyTorqueImpulse() {}
  setLinearDamping() {}
  setBodyType() {}
  numColliders() { return 0; }
  collider() { return { setFriction: () => {} }; }
}

function runtimeFor(tipping: TippingState) {
  const deps: RaftPhysicsRuntimeDeps = {
    buoyancyState: { current: { submergedRatio: 0.5, buoyancyForce: 0, isFloating: true } },
    tippingState: { current: tipping },
    paddleState: { current: { leftPaddle: false, rightPaddle: false } },
    staminaState: { current: { current: STAMINA.MAX, regenDelay: 0, isExhausted: false } },
    stunState: { current: { active: false, timer: 0 } },
    forwardBiasTimer: { current: 0 },
    foamParticles: new ParticlePool(4),
    shedParticles: new ParticlePool(4),
    camera: new THREE.PerspectiveCamera(),
    controls: {
      getControls: () => ({
        forward: false, backward: false, leftward: false, rightward: false, jump: false,
        sprint: false, brake: false, dodge: false, paddleLeft: false, paddleRight: false,
        isPointerLocked: true,
      }),
    },
    stepWorkerProxy: () => {},
    currentFov: { current: 75 },
  };
  return createRaftPhysicsRuntime(deps);
}

const rolled = (radians: number): QuatLike => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, radians));
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};

describe('raft tipping', () => {
  it('tips only after the danger tilt is held past DANGER_TIME', () => {
    const tipping: TippingState = {
      rollAngle: 0, pitchAngle: 0, dangerTime: 0, isTipped: false, lastSafePosition: new THREE.Vector3(),
    };
    const runtime = runtimeFor(tipping);
    const body = new StubRaft();
    body.rot = rolled(TIPPING.DANGER_THRESHOLD + 0.1);

    const dt = 1 / 60;
    let tipped = false;
    let held = 0;
    while (!tipped && held < TIPPING.DANGER_TIME + 1) {
      tipped = runtime.handleTipping(body, dt);
      held += dt;
    }
    expect(tipped).toBe(true);
    expect(tipping.isTipped).toBe(true);
    expect(held).toBeGreaterThanOrEqual(TIPPING.DANGER_TIME);
  });

  it('records the safe position while level, and resetRaft returns there upright and still', () => {
    const tipping: TippingState = {
      rollAngle: 0, pitchAngle: 0, dangerTime: 0, isTipped: false, lastSafePosition: new THREE.Vector3(),
    };
    const runtime = runtimeFor(tipping);
    const body = new StubRaft();

    runtime.handleTipping(body, 1 / 60); // level → this is the safe spot
    expect(tipping.lastSafePosition.toArray()).toEqual([4, 0, -40]);

    body.pos = { x: 30, y: -50, z: -90 };
    body.rot = rolled(Math.PI * 0.6);
    tipping.isTipped = true;
    tipping.dangerTime = 3;
    runtime.resetRaft(body);

    expect(body.pos.x).toBe(4);
    expect(body.pos.z).toBe(-40);
    expect(body.pos.y).toBe(Math.max(0, WATER_PHYSICS.LEVEL + TIPPING.RESET_HEIGHT));
    expect(body.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(body.ang).toEqual({ x: 0, y: 0, z: 0 });
    expect(body.rot).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(tipping.isTipped).toBe(false);
    expect(tipping.dangerTime).toBe(0);
  });
});
