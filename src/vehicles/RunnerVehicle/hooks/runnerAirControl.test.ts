import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BANK_CONFIG, JUMP_CONFIG } from '../constants';
import {
  POSITION_SANE,
  isFiniteVec3,
  isFiniteImpulse,
  isPositionSane,
  computeJumpImpulse,
  computeStrafeEligibility,
  getHorizontalCameraForward,
  buildCameraRelativeDirs,
  tickJumpStateMachine,
} from './runnerAirControl';

describe('runnerAirControl helpers', () => {
  it('validates finite vec3 / impulse', () => {
    expect(isFiniteVec3({ x: 1, y: 2, z: 3 })).toBe(true);
    expect(isFiniteVec3({ x: NaN, y: 0, z: 0 })).toBe(false);
    expect(isFiniteImpulse({ x: 0, y: Infinity, z: 0 })).toBe(false);
  });

  it('enforces POSITION_SANE bounds', () => {
    expect(isPositionSane({ x: 0, y: 10, z: 0 })).toBe(true);
    expect(isPositionSane({ x: 0, y: POSITION_SANE.yMin - 1, z: 0 })).toBe(false);
    expect(isPositionSane({ x: POSITION_SANE.xzMax + 1, y: 0, z: 0 })).toBe(false);
  });

  it('matches slope/bank jump impulse math', () => {
    const jumpForce = 10;
    const sinSlope = 0.5;
    const jumpForwardDir = { x: 0, z: -1 };
    const groundNormal = { x: 0.6, z: 0 };
    const bankAngle = BANK_CONFIG.KICKOFF_MAX_BANK_DEG;
    const impulse = computeJumpImpulse({
      jumpForce,
      sinSlope,
      jumpForwardDir,
      groundNormal,
      bankAngle,
    });
    const forwardBias = jumpForce * sinSlope * JUMP_CONFIG.SLOPE_FORWARD_BIAS;
    const bankBlend = Math.min(0.5, Math.abs(bankAngle) / BANK_CONFIG.KICKOFF_MAX_BANK_DEG);
    expect(impulse).toEqual({
      x: jumpForwardDir.x * forwardBias + groundNormal.x * jumpForce * bankBlend,
      y: jumpForce,
      z: jumpForwardDir.z * forwardBias + groundNormal.z * jumpForce * bankBlend,
    });
  });

  it('gates strafe on commit, recovery, and dodge', () => {
    expect(computeStrafeEligibility('grounded', 0, 'ready')).toBe(true);
    expect(computeStrafeEligibility('airborne', 0.05, 'ready')).toBe(false);
    expect(computeStrafeEligibility('airborne', 0, 'ready')).toBe(true);
    expect(computeStrafeEligibility('recovering', 0, 'ready')).toBe(false);
    expect(computeStrafeEligibility('grounded', 0, 'dodging')).toBe(false);
  });

  it('builds camera-relative dirs with warm fallback', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.65, 0);
    camera.lookAt(0, 1.65, -10);
    camera.updateMatrixWorld(true);

    const out = new THREE.Vector3();
    getHorizontalCameraForward(camera, true, out);
    expect(out.y).toBe(0);
    expect(out.length()).toBeCloseTo(1, 5);
    expect(out.z).toBeLessThan(0);

    const cold = getHorizontalCameraForward(camera, false, out);
    expect(cold).toEqual(expect.objectContaining({ x: 0, y: 0, z: -1 }));

    const { forwardDir, rightDir } = buildCameraRelativeDirs(camera, true);
    expect(forwardDir.length()).toBeCloseTo(1, 5);
    expect(rightDir.length()).toBeCloseTo(1, 5);
    expect(Math.abs(forwardDir.dot(rightDir))).toBeLessThan(1e-5);
  });

  it('tickJumpStateMachine leaves ground and applies jump impulse', () => {
    const impulses: Array<{ tag: string; impulse: { x: number; y: number; z: number } }> = [];
    const js = {
      state: 'grounded',
      hasDoubleJumped: false,
      airTime: 0,
      commitTimer: 0,
      timeSinceGrounded: 0,
      verticalVelocityOnLeave: 0,
      lastGroundY: 0,
      jumpReleased: true,
    };
    const slopeState = {
      current: {
        currentMultiplier: 1,
        lastGroundNormal: { x: 0, z: 0 },
        bankAngle: 0,
      },
    };

    tickJumpStateMachine({
      js,
      dt: 1 / 60,
      isGrounded: false,
      jump: false,
      jumpJustPressed: false,
      vel: { x: 0, y: -1, z: -5 },
      pos: { x: 0, y: 2, z: 0 },
      sinSlope: 0,
      jumpForwardDir: { x: 0, z: -1 },
      slopeState,
      applyImpulseWithDebugTracking: (tag, impulse) => impulses.push({ tag, impulse }),
      setLinvelSafe: () => {},
    });
    expect(js.state).toBe('airborne');
    expect(js.verticalVelocityOnLeave).toBe(-1);

    js.state = 'grounded';
    tickJumpStateMachine({
      js,
      dt: 1 / 60,
      isGrounded: true,
      jump: true,
      jumpJustPressed: true,
      vel: { x: 0, y: 0, z: -5 },
      pos: { x: 0, y: 2, z: 0 },
      sinSlope: 0,
      jumpForwardDir: { x: 0, z: -1 },
      slopeState,
      applyImpulseWithDebugTracking: (tag, impulse) => impulses.push({ tag, impulse }),
      setLinvelSafe: () => {},
    });
    expect(js.state).toBe('airborne');
    expect(impulses.some((entry) => entry.tag === 'jump')).toBe(true);
    expect(js.commitTimer).toBe(JUMP_CONFIG.COMMIT_DURATION);
  });
});
