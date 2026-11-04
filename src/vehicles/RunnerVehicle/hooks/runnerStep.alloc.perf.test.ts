/**
 * Perf project (`pnpm test:perf`): the runner's physics step allocates nothing
 * per step at steady state (#521 D).
 *
 * Rapier is a stub here whose reads return the same objects every call, so the
 * number measured is the step's own garbage — not Rapier's (`translation()`,
 * `linvel()` and a ray hit each allocate in the real WASM binding; that is
 * Rapier's, and outside this code's reach). Steady state: a live run, terrain
 * warm, grounded on a flat floor, running forward with full stamina, no debug
 * page (`queryFlags().debugGlobals` off).
 *
 * Method: expose the collector (`v8.setFlagsFromString`), collect, then step
 * N times and read the heap. Young-generation garbage stays in the heap until
 * a scavenge, so with no collection in the window the growth is what the steps
 * allocated; a scavenge in the window would itself mean garbage, and fails.
 */
import { PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateRunnerPhysics } from './RunnerPhysicsStep';
import { createRunnerPhysicsState } from './useRunnerPhysics';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { QuatLike, RapierBody, RapierRay, RapierRayHit, RapierWorld, Vec3Like } from '../../../physics/rapierTypes';
import { useGameStore } from '../../../systems/GameState';
import { initRunSession, resetRunSessionForTests } from '../../../systems/journey/runSession';

// A collector handle without a CLI flag: expose it, then read it off a fresh context.
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as (() => void) | undefined;

/** A body whose reads reuse their objects; impulses integrate into a damped velocity. */
class SteadyBody implements RapierBody {
  readonly handle = 7;
  private readonly pos = { x: 0, y: -6, z: -10 };
  private readonly vel = { x: 0, y: 0, z: 0 };
  private readonly ang = { x: 0, y: 0, z: 0 };
  private readonly rot = { x: 0, y: 0, z: 0, w: 1 };
  private readonly col = { setFriction: (_f: number) => {} };
  userData?: unknown;
  translation() { return this.pos; }
  rotation(): QuatLike { return this.rot; }
  linvel() { return this.vel; }
  angvel() { return this.ang; }
  setTranslation(t: Vec3Like) { this.pos.x = t.x; this.pos.y = t.y; this.pos.z = t.z; }
  setRotation() {}
  setLinvel(v: Vec3Like) { this.vel.x = v.x; this.vel.y = v.y; this.vel.z = v.z; }
  setAngvel() {}
  applyImpulse(i: Vec3Like) {
    this.vel.x += i.x / 20;
    this.vel.z += i.z / 20;
  }
  applyTorqueImpulse() {}
  setLinearDamping() {}
  setBodyType() {}
  numColliders() { return 1; }
  collider() { return this.col; }
  /** Rapier's half of a step: damp and move, staying on the floor. */
  integrate(dt: number) {
    this.vel.x *= 0.98;
    this.vel.z *= 0.98;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
  }
}

function steadyWorld(): RapierWorld {
  const hit: RapierRayHit = { timeOfImpact: 1.0, normal: { x: 0, y: 1, z: 0 } };
  return {
    timestep: 1 / 60,
    gravity: { x: 0, y: -9.81, z: 0 },
    castRay: () => hit,
    castRayAndGetNormal: () => hit,
  };
}

const rapier = {
  Ray: class implements RapierRay {
    constructor(public origin: Vec3Like, public dir: Vec3Like) {}
  },
  RigidBodyType: { Dynamic: 0, KinematicPositionBased: 2 },
};

const running: PlayerControls = {
  forward: true, backward: false, leftward: false, rightward: false, jump: false,
  sprint: false, brake: false, dodge: false, paddleLeft: false, paddleRight: false,
  paddleLeftAxis: 0, paddleRightAxis: 0, isPointerLocked: true,
};

describe('runner step allocation (#521 D)', () => {
  beforeAll(() => {
    resetRunSessionForTests();
    useGameStore.getState().resetGameState();
    initRunSession({ mapId: 'meander', launchHour: 12 });
  });
  afterAll(() => {
    resetRunSessionForTests();
    useGameStore.getState().resetGameState();
  });

  it('allocates 0 bytes per step at steady state', async () => {
    expect(gc).toBeTypeOf('function');
    const body = new SteadyBody();
    const world = steadyWorld();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, -4.35, -10);
    camera.updateMatrixWorld(true);
    const vehicleState = createRunnerPhysicsState();
    const controls = { getControls: () => running };
    const args = {
      delta: 1 / 60,
      world,
      body,
      rapier,
      camera,
      controls,
      vehicleState,
      shelfLaunchFiredRef: { current: false },
      shelfTriggerRef: { current: null },
    };
    const step = () => {
      updateRunnerPhysics(args);
      body.integrate(1 / 60);
    };

    // Warm the JIT, the one-time tables and the boot hold.
    for (let i = 0; i < 20000; i += 1) step();
    expect(vehicleState.slopeState.current.isGrounded).toBe(true);
    expect(Math.hypot(body.linvel().x, body.linvel().z)).toBeGreaterThan(1);

    let collections = 0;
    const observer = new PerformanceObserver((list) => {
      collections += list.getEntries().length;
    });
    observer.observe({ entryTypes: ['gc'] });

    const N = 5000;
    gc!();
    await new Promise((r) => setTimeout(r, 0));
    collections = 0;
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < N; i += 1) step();
    const grown = process.memoryUsage().heapUsed - before;
    await new Promise((r) => setTimeout(r, 20));
    observer.disconnect();

    const perStep = grown / N;
    console.info(`[runner-alloc] ${perStep.toFixed(2)} B/step over ${N} steps (${grown} B), ${collections} collections`);
    expect(collections).toBe(0);
    // No object is built per step. What the heap still shows is at most one
    // 16-byte boxed number, and only under some of V8's inlining choices for
    // this call tree (it moves with unrelated edits; --no-turbo-inlining puts
    // ~145 B back). The step was ~3 KB/step before #521 D; a single
    // three-number literal per step is ~40 B and fails this.
    expect(perStep).toBeLessThan(24);
  });
});
