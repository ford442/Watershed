// @vitest-environment node
/**
 * The runner on SimCore (#556 A): `vehicle-runner` steps from `ctx.input` and
 * `ctx.game` alone — a plain run state, no store, no React — after the
 * `physics-world` step, and reports presentation as cues. Runs in vitest's
 * `node` environment: no DOM, no window — what a headless campaign has.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SimCore, SIM_DT } from '../../sim/core/SimCore';
import { createPlainSimGame } from '../../sim/core/simGame';
import { createInputFrame, InputButton } from '../../input/InputFrame';
import { createRapierWorldSimSystem } from '../../physics/rapierWorldSimSystem';
import { gameEvents } from '../../systems/events/GameEvents';
import type { QuatLike, RapierBody, RapierRay, RapierWorld, Vec3Like } from '../../physics/rapierTypes';
import { createRunnerPhysicsState } from './hooks/runnerPhysicsState';
import { createRunnerSimSystem, RUNNER_SIM_ID } from './runnerSimSystem';
import { syncRunnerCamera } from './runnerCameraSync';

/** A body on a flat floor; impulses integrate when the "world" steps it. */
class FloorBody implements RapierBody {
  readonly handle = 3;
  pos: Vec3Like = { x: 0, y: -6, z: -10 };
  vel: Vec3Like = { x: 0, y: 0, z: 0 };
  userData?: unknown;
  translation() { return { ...this.pos }; }
  rotation(): QuatLike { return { x: 0, y: 0, z: 0, w: 1 }; }
  linvel() { return { ...this.vel }; }
  angvel() { return { x: 0, y: 0, z: 0 }; }
  setTranslation(t: Vec3Like) { this.pos = { ...t }; }
  setRotation() {}
  setLinvel(v: Vec3Like) { this.vel = { ...v }; }
  setAngvel() {}
  applyImpulse(i: Vec3Like) {
    this.vel = { x: this.vel.x + i.x / 75, y: this.vel.y + i.y / 75, z: this.vel.z + i.z / 75 };
  }
  applyTorqueImpulse() {}
  setLinearDamping() {}
  setBodyType() {}
  numColliders() { return 1; }
  collider() { return { setFriction: () => {} }; }
  integrate(dt: number) {
    this.pos = { x: this.pos.x + this.vel.x * dt, y: this.pos.y, z: this.pos.z + this.vel.z * dt };
  }
}

const floorHit = () => ({ timeOfImpact: 1.0, normal: { x: 0, y: 1, z: 0 } });
const world: RapierWorld = { timestep: SIM_DT, gravity: { x: 0, y: -9.81, z: 0 }, castRay: floorHit, castRayAndGetNormal: floorHit };
const rapier = {
  Ray: class implements RapierRay {
    constructor(public origin: Vec3Like, public dir: Vec3Like) {}
  },
  RigidBodyType: { Dynamic: 0, KinematicPositionBased: 2 },
};

function setup() {
  const core = new SimCore();
  const game = createPlainSimGame();
  core.ctx.game = game;
  const input = createInputFrame();
  core.ctx.input = input;
  const body = new FloorBody();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, -4.35, -10);
  camera.updateMatrixWorld(true);
  const state = createRunnerPhysicsState();
  const order: string[] = [];
  core.register(
    createRapierWorldSimSystem((dt) => {
      order.push('world');
      body.integrate(dt);
    }),
  );
  core.register(
    createRunnerSimSystem({
      world,
      rapier,
      getBody: () => body,
      camera,
      vehicleState: state,
      shelfLaunchFiredRef: { current: false },
      shelfTriggerRef: { current: null },
    }),
  );
  return { core, game, input, body, camera, state, order };
}

afterEach(() => gameEvents.clear());

describe('vehicle-runner on SimCore', () => {
  it('steps after the world: physics-world (92), then vehicle-runner (95)', () => {
    const { core, order } = setup();
    expect(core.getSystemIds()).toEqual(['physics-world', RUNNER_SIM_ID]);
    core.step();
    core.step();
    expect(order).toEqual(['world', 'world']);
  });

  it('runs forward from ctx.input with a plain run state (no store)', () => {
    const { core, input, body } = setup();
    input.moveY = 1;
    for (let i = 0; i < 120; i += 1) core.step();
    expect(body.vel.z).toBeLessThan(0);
    expect(body.pos.z).toBeLessThan(-10.1);
  });

  it('integrates sprint stamina into ctx.game', () => {
    const { core, game, input } = setup();
    input.moveY = 1;
    input.buttons = InputButton.SPRINT;
    for (let i = 0; i < 120; i += 1) core.step();
    expect(game.view.sprintStamina).toBeLessThan(1);
  });

  it('reports a jump as a vehicle-jump cue, not a sound', () => {
    const { core, input } = setup();
    const jumps: boolean[] = [];
    gameEvents.on('vehicle-jump', ({ double }) => jumps.push(double));
    core.step(); // warm: grounded
    input.buttons = InputButton.JUMP;
    core.step();
    expect(jumps).toEqual([false]);
  });

  it('flags the camera follow, which the host (or a headless run) applies', () => {
    const { core, body, camera, state } = setup();
    core.step();
    expect(state.stepScratch.followCamera).toBe(true);
    const before = camera.position.z;
    body.pos = { ...body.pos, z: body.pos.z - 10 };
    syncRunnerCamera(camera, body, state);
    expect(camera.position.z).toBeLessThan(before);
  });

  it('skips the step with no body', () => {
    const state = createRunnerPhysicsState();
    const empty = new SimCore();
    empty.register(
      createRunnerSimSystem({
        world, rapier, getBody: () => null, camera: new THREE.PerspectiveCamera(), vehicleState: state,
        shelfLaunchFiredRef: { current: false }, shelfTriggerRef: { current: null },
      }),
    );
    expect(() => empty.step()).not.toThrow();
    expect(state.stepScratch.followCamera).toBe(false);
  });
});
