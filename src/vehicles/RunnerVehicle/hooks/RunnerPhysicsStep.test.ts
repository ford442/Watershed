/**
 * RunnerPhysicsStep on a stub Rapier body (#503 F): boot hold → ground →
 * jump → airborne, typed against RapierBody / RapierWorld (#503 D) so no
 * Rapier WASM is needed.
 */
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateRunnerPhysics } from './RunnerPhysicsStep';
import { useRunnerPhysicsState } from './useRunnerPhysics';
import { JUMP_CONFIG } from '../constants';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { QuatLike, RapierBody, RapierRay, RapierWorld, Vec3Like } from '../../../physics/rapierTypes';
import { useGameStore } from '../../../systems/GameState';

const DYNAMIC = 0;
const KINEMATIC = 2;

class StubBody implements RapierBody {
  readonly handle = 7;
  pos: Vec3Like = { x: 0, y: -6, z: -10 };
  vel: Vec3Like = { x: 0, y: 0, z: 0 };
  bodyType = DYNAMIC;
  impulses: Vec3Like[] = [];
  userData?: unknown;
  translation() { return { ...this.pos }; }
  rotation(): QuatLike { return { x: 0, y: 0, z: 0, w: 1 }; }
  linvel() { return { ...this.vel }; }
  angvel() { return { x: 0, y: 0, z: 0 }; }
  setTranslation(t: Vec3Like) { this.pos = { ...t }; }
  setRotation() {}
  setLinvel(v: Vec3Like) { this.vel = { ...v }; }
  setAngvel() {}
  applyImpulse(i: Vec3Like) { this.impulses.push({ ...i }); }
  applyTorqueImpulse() {}
  setLinearDamping() {}
  setBodyType(type: number) { this.bodyType = type; }
  numColliders() { return 1; }
  collider() { return { setFriction: () => {} }; }
}

/** A flat floor `groundToi` metres below each ray origin, or none. */
function stubWorld(state: { groundToi: number | null }): RapierWorld {
  const hit = () => (state.groundToi === null ? null : { timeOfImpact: state.groundToi, normal: { x: 0, y: 1, z: 0 } });
  return {
    timestep: 1 / 60,
    gravity: { x: 0, y: -9.81, z: 0 },
    castRay: hit,
    castRayAndGetNormal: hit,
  };
}

const rapier = {
  Ray: class implements RapierRay {
    constructor(public origin: Vec3Like, public dir: Vec3Like) {}
  },
  RigidBodyType: { Dynamic: DYNAMIC, KinematicPositionBased: KINEMATIC },
};

const idleControls = (): PlayerControls => ({
  forward: false, backward: false, leftward: false, rightward: false, jump: false,
  sprint: false, brake: false, dodge: false, paddleLeft: false, paddleRight: false,
  paddleLeftAxis: 0, paddleRightAxis: 0, isPointerLocked: true,
});

describe('updateRunnerPhysics state machine', () => {
  let body: StubBody;
  let ground: { groundToi: number | null };
  let controls: PlayerControls;
  let vehicleState: ReturnType<typeof useRunnerPhysicsState>;
  const camera = new THREE.PerspectiveCamera();

  const step = () =>
    updateRunnerPhysics({
      delta: 1 / 60,
      world: stubWorld(ground),
      body,
      rapier,
      camera,
      controls: { getControls: () => controls },
      vehicleState,
      shelfLaunchFiredRef: { current: false },
      shelfTriggerRef: { current: null },
    });

  beforeEach(() => {
    useGameStore.getState().resetGameState();
    body = new StubBody();
    ground = { groundToi: 1.0 };
    controls = idleControls();
    vehicleState = renderHook(() => useRunnerPhysicsState()).result.current;
    camera.position.set(0, -4.35, -10);
    camera.updateMatrixWorld(true);
  });

  afterEach(() => {
    useGameStore.getState().resetGameState();
  });

  it('holds the body kinematic until the ground ray lands, then goes dynamic', () => {
    ground.groundToi = null;
    step();
    expect(body.bodyType).toBe(KINEMATIC);
    expect(body.impulses).toEqual([]); // no gameplay impulse before the terrain is warm

    ground.groundToi = 1.0;
    step();
    expect(body.bodyType).toBe(DYNAMIC);
    expect(vehicleState.slopeState.current.isGrounded).toBe(true);
  });

  it('a jump press from the ground leaves the ground with an upward impulse', () => {
    step(); // warm: grounded
    expect(vehicleState.jumpState.current.state).toBe('grounded');

    controls = { ...idleControls(), jump: true };
    body.impulses = [];
    step();

    expect(vehicleState.jumpState.current.state).toBe('airborne');
    const up = body.impulses.reduce((sum, i) => sum + i.y, 0);
    expect(up).toBeGreaterThan(JUMP_CONFIG.FORCE * 0.5);
  });

  it('losing the ground goes airborne only after the hysteresis frames', () => {
    step();
    ground.groundToi = null;
    for (let i = 0; i < JUMP_CONFIG.GROUNDED_HYSTERESIS_FRAMES - 1; i += 1) {
      step();
      expect(vehicleState.jumpState.current.state).toBe('grounded');
    }
    step();
    expect(vehicleState.jumpState.current.state).toBe('airborne');
  });
});
