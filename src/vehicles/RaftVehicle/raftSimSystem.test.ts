// @vitest-environment node
/**
 * The raft on SimCore (#577 A.1): `vehicle-raft` steps from `ctx.input` and
 * `ctx.game` alone — a plain run state, no store, no React, no camera — at the
 * runner's slot after `physics-world`, on `SIM_DT`. Node environment: what a
 * headless campaign has.
 */
import { describe, expect, it } from 'vitest';
import { SimCore, SIM_DT } from '../../sim/core/SimCore';
import { createPlainSimGame } from '../../sim/core/simGame';
import { createInputFrame } from '../../input/InputFrame';
import { createRapierWorldSimSystem } from '../../physics/rapierWorldSimSystem';
import { gameEvents } from '../../systems/events/GameEvents';
import type { QuatLike, RapierBody, Vec3Like } from '../../physics/rapierTypes';
import { createRaftSimSystem, RAFT_SIM_ID, type RaftWorkerLink } from './raftSimSystem';
import { STAMINA } from './constants';

class RaftBody implements RapierBody {
  readonly handle = 5;
  pos: Vec3Like = { x: 0, y: -10, z: -10 };
  vel: Vec3Like = { x: 0, y: 0, z: 0 };
  ang: Vec3Like = { x: 0, y: 0, z: 0 };
  rot: QuatLike = { x: 0, y: 0, z: 0, w: 1 };
  impulses: Vec3Like[] = [];
  translation() { return { ...this.pos }; }
  rotation() { return { ...this.rot }; }
  linvel() { return { ...this.vel }; }
  angvel() { return { ...this.ang }; }
  setTranslation(t: Vec3Like) { this.pos = { ...t }; }
  // Field reads: the step passes a THREE.Quaternion, whose spread is `_x` / `_y` / ….
  setRotation(q: QuatLike) { this.rot = { x: q.x, y: q.y, z: q.z, w: q.w }; }
  setLinvel(v: Vec3Like) { this.vel = { ...v }; }
  setAngvel(v: Vec3Like) { this.ang = { ...v }; }
  applyImpulse(i: Vec3Like) {
    this.impulses.push({ ...i });
    this.vel = { x: this.vel.x + i.x / 150, y: this.vel.y + i.y / 150, z: this.vel.z + i.z / 150 };
  }
  applyTorqueImpulse() {}
  setLinearDamping() {}
  setBodyType() {}
  numColliders() { return 1; }
  collider() { return { setFriction: () => {} }; }
}

/** The sheet the hull straddles (vehicleWaterDatum in the game). */
const SHEET = -10.1;

function setup(worker: RaftWorkerLink | null = null) {
  const core = new SimCore();
  const game = createPlainSimGame();
  core.ctx.game = game;
  const input = createInputFrame();
  core.ctx.input = input;
  const body = new RaftBody();
  const order: string[] = [];
  core.register(createRapierWorldSimSystem(() => order.push('world')));
  const raft = createRaftSimSystem({ getBody: () => body, worker, sampleWaterLevel: () => SHEET });
  core.register(raft);
  return { core, game, input, body, raft, order };
}

describe('vehicle-raft on SimCore', () => {
  it('registers at the vehicle slot, after the world step', () => {
    const { core } = setup();
    expect(core.getSystemIds()).toEqual(['physics-world', RAFT_SIM_ID]);
  });

  it('paddles forward from ctx.input: thrust down -Z, stamina spent, a stroke on the sim step', () => {
    const { core, input, body, raft } = setup();
    input.moveY = 1; // W: both paddles
    core.step();
    expect(raft.state.buoyancyState.current.isFloating).toBe(true);
    expect(body.vel.z).toBeLessThan(0);
    expect(raft.state.staminaState.current.current).toBeLessThan(STAMINA.MAX);
    // The run's clock is SimCore's: one step is SIM_DT of raft time.
    expect(raft.state.time).toBeCloseTo(SIM_DT, 12);
  });

  it('reads the run state through ctx.game, not the store: the delta is calm water', () => {
    const calm = setup();
    calm.game.view.currentBiome = 'delta';
    const rough = setup();
    rough.game.view.currentBiome = 'canyonSummer';
    for (const s of [calm, rough]) {
      s.body.vel = { x: 0, y: 0, z: -8 };
      s.core.step();
    }
    // Turbulence wobble scales with CALM_TURBULENCE_SCALE in the delta: less roll.
    expect(Math.abs(calm.body.rot.z)).toBeLessThan(Math.abs(rough.body.rot.z));
  });

  it('is repeatable: two rafts on the same input read the same numbers', () => {
    const a = setup();
    const b = setup();
    for (const s of [a, b]) {
      s.input.moveY = 1;
      s.input.moveX = 0.9;
      for (let i = 0; i < 90; i += 1) s.core.step();
    }
    expect(a.body.vel).toEqual(b.body.vel);
    expect(a.body.rot).toEqual(b.body.rot);
    expect(a.raft.state.staminaState.current).toEqual(b.raft.state.staminaState.current);
  });

  it('a run reset gives back a fresh raft: stamina, stun, momentum', () => {
    const { core, input, raft } = setup();
    input.moveY = 1;
    for (let i = 0; i < 3; i += 1) core.step();
    expect(raft.state.forwardBiasState.current).toBeGreaterThan(0);
    core.reset();
    expect(raft.state.staminaState.current.current).toBe(STAMINA.MAX);
    expect(raft.state.forwardBiasState.current).toBe(0);
    expect(raft.state.time).toBe(0);
  });

  it('hands the stroke to the Rapier worker once it owns the body, and applies none itself', () => {
    const posted: number[][][] = [];
    const worker: RaftWorkerLink = { ownsBody: () => true, step: (_b, _dt, impulses) => posted.push(impulses) };
    const { core, input, body } = setup(worker);
    input.moveY = 1;
    core.step();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.length).toBeGreaterThan(0);
    expect(body.impulses).toHaveLength(0);
  });

  it('emits a paddle cue for a one-sided stroke (the host plays it)', () => {
    const { core, input } = setup();
    const sides: string[] = [];
    const off = gameEvents.on('raft-paddle', ({ side }) => sides.push(side));
    input.paddleL = 1;
    for (let i = 0; i < 60; i += 1) core.step();
    off();
    expect(sides.length).toBeGreaterThan(0);
    expect(new Set(sides)).toEqual(new Set(['left']));
  });
});
