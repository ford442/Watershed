// @vitest-environment node
/**
 * The vehicle tuner on SimCore (#577 A.2): what `components/VehicleTuner.tsx`
 * did in a `useFrame`, on `ctx.input` and `ctx.time` — any device turns, any
 * device's jump press boosts, and the cooldowns are sim seconds.
 */
import { describe, expect, it } from 'vitest';
import { SimCore, SIM_DT } from '../../sim/core/SimCore';
import { createInputFrame, InputButton } from '../../input/InputFrame';
import { gameEvents } from '../events/GameEvents';
import { VEHICLE_TUNING } from '../../constants/vehicleTuning';
import type { QuatLike, RapierRay, RapierRayHit, Vec3Like } from '../../physics/rapierTypes';
import { createVehicleTunerSimSystem, VEHICLE_TUNER_SIM_ID, type TunedBody } from './vehicleTunerSimSystem';

class Body implements TunedBody {
  readonly handle = 1;
  pos: Vec3Like = { x: 0, y: -20, z: 0 };
  vel: Vec3Like = { x: 0, y: 0, z: -6 };
  linearDamping = NaN;
  impulses: Vec3Like[] = [];
  translation() { return { ...this.pos }; }
  rotation(): QuatLike { return { x: 0, y: 0, z: 0, w: 1 }; }
  linvel() { return { ...this.vel }; }
  angvel() { return { x: 0, y: 0, z: 0 }; }
  setTranslation() {}
  setRotation() {}
  setLinvel(v: Vec3Like) { this.vel = { ...v }; }
  setAngvel() {}
  applyImpulse(i: Vec3Like) { this.impulses.push({ ...i }); }
  applyTorqueImpulse() {}
  setLinearDamping(d: number) { this.linearDamping = d; }
  setAngularDamping() {}
  mass() { return 75; }
  setBodyType() {}
  numColliders() { return 1; }
  collider() { return { setFriction: () => {} }; }
}

function setup(wallAt: number | null = null) {
  const core = new SimCore();
  const input = createInputFrame();
  core.ctx.input = input;
  const body = new Body();
  const world = {
    castRay: (): RapierRayHit | null => (wallAt === null ? null : { timeOfImpact: wallAt }),
  };
  const rapier = {
    Ray: class implements RapierRay {
      constructor(public origin: Vec3Like, public dir: Vec3Like) {}
    },
  };
  const tuner = createVehicleTunerSimSystem({ world, rapier, getBody: () => body });
  core.register(tuner);
  return { core, input, body, tuner };
}

describe('vehicle-tuner on SimCore', () => {
  it('is one system at the slot after the vehicle', () => {
    const { core, tuner } = setup();
    expect(core.getSystemIds()).toEqual([VEHICLE_TUNER_SIM_ID]);
    expect(tuner.order).toBe(96);
  });

  it('lerps damping toward the water value on SIM_DT', () => {
    const { core, body } = setup();
    core.step();
    const k = VEHICLE_TUNING.dampingLerpSpeed * SIM_DT;
    const expected = VEHICLE_TUNING.linearDampingAir + (VEHICLE_TUNING.linearDampingWater - VEHICLE_TUNING.linearDampingAir) * k;
    expect(body.linearDamping).toBe(expected);
  });

  it('boosts on the jump press, not the hold, with the cooldown in sim seconds', () => {
    const { core, input } = setup();
    const kinds: string[] = [];
    const off = gameEvents.on('vehicle-surge', ({ kind }) => kinds.push(kind));
    input.buttons = InputButton.JUMP;
    for (let i = 0; i < 30; i += 1) core.step(); // held: one boost
    expect(kinds).toEqual(['boost']);
    input.buttons = 0;
    core.step();
    input.buttons = InputButton.JUMP;
    core.step(); // pressed again inside the cooldown: nothing
    expect(kinds).toEqual(['boost']);
    input.buttons = 0;
    const cooldownSteps = Math.ceil(VEHICLE_TUNING.boostCooldown / SIM_DT);
    for (let i = 0; i < cooldownSteps; i += 1) core.step();
    input.buttons = InputButton.JUMP;
    core.step();
    off();
    expect(kinds).toEqual(['boost', 'boost']);
  });

  it('turns on any device\'s strafe: a wall boost when pressing into a wall at speed', () => {
    const { core, input } = setup(1.0);
    const kinds: string[] = [];
    const off = gameEvents.on('vehicle-surge', ({ kind }) => kinds.push(kind));
    input.moveX = -1; // the left ray hits first
    core.step();
    off();
    expect(kinds).toEqual(['wall']);
  });

  it('caps the speed', () => {
    const { core, body } = setup();
    body.vel = { x: 0, y: 0, z: -(VEHICLE_TUNING.maxSpeedCap * 2) };
    core.step();
    expect(Math.hypot(body.vel.x, body.vel.z)).toBeCloseTo(VEHICLE_TUNING.maxSpeedCap, 9);
  });
});
