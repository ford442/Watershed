/**
 * Unit tests for the segment-14 launch-shelf helper.
 */

import {
  getSegment14LaunchShelfConfig,
  computeShelfTrigger,
  isInsideShelfTrigger,
  getShelfDownstreamSpeed,
  computeShelfLaunchImpulse,
  tryFireShelfLaunch,
  type Vec3,
  type ShelfTrigger,
} from './shelfLaunch';
import { VEHICLE_TUNING } from '../../constants/vehicleTuning';

describe('shelfLaunch', () => {
  const spawnPoint: Vec3 = { x: 10, y: -40, z: -200 };

  describe('getSegment14LaunchShelfConfig', () => {
    it('returns the authored launchShelf config for segment 14', () => {
      const config = getSegment14LaunchShelfConfig();
      expect(config).not.toBeNull();
      expect(config?.rockRef.localX).toBe(-13);
      expect(config?.rockRef.localZ).toBe(-35);
      expect(config?.rockRef.scale).toBe(4.0);
    });
  });

  describe('computeShelfTrigger', () => {
    it('returns null for a null spawn point', () => {
      expect(computeShelfTrigger(null)).toBeNull();
    });

    it('returns a trigger whose center is downstream of the spawn point', () => {
      const trigger = computeShelfTrigger(spawnPoint);
      expect(trigger).not.toBeNull();
      // Waterfall tangent points downward and slightly forward (-Z).
      expect(trigger!.center.z).toBeLessThan(spawnPoint.z);
      expect(trigger!.center.y).toBeLessThan(spawnPoint.y);
    });

    it('uses positive half-extents', () => {
      const trigger = computeShelfTrigger(spawnPoint)!;
      expect(trigger.halfWidth).toBeGreaterThan(0);
      expect(trigger.halfHeight).toBeGreaterThan(0);
      expect(trigger.halfLength).toBeGreaterThan(0);
    });
  });

  describe('isInsideShelfTrigger', () => {
    const trigger: ShelfTrigger = {
      center: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 },
      halfWidth: 2,
      halfHeight: 2,
      halfLength: 2,
    };

    it('returns true for a point at the center', () => {
      expect(isInsideShelfTrigger({ x: 0, y: 0, z: 0 }, trigger)).toBe(true);
    });

    it('returns true for a point inside the box', () => {
      expect(isInsideShelfTrigger({ x: 1, y: 1, z: 1 }, trigger)).toBe(true);
    });

    it('returns false for a point outside the box', () => {
      expect(isInsideShelfTrigger({ x: 5, y: 0, z: 0 }, trigger)).toBe(false);
      expect(isInsideShelfTrigger({ x: 0, y: 5, z: 0 }, trigger)).toBe(false);
      expect(isInsideShelfTrigger({ x: 0, y: 0, z: 5 }, trigger)).toBe(false);
    });

    it('returns false for a null trigger', () => {
      expect(isInsideShelfTrigger({ x: 0, y: 0, z: 0 }, null)).toBe(false);
    });
  });

  describe('getShelfDownstreamSpeed', () => {
    it('returns the positive projection onto the downstream direction', () => {
      // Downstream direction is horizontal and roughly -Z.
      const speed = getShelfDownstreamSpeed({ x: 0, y: 10, z: -20 });
      expect(speed).toBeGreaterThan(0);
    });

    it('returns zero for upstream velocity', () => {
      const speed = getShelfDownstreamSpeed({ x: 0, y: 0, z: 20 });
      expect(speed).toBe(0);
    });

    it('returns zero for invalid velocity', () => {
      expect(getShelfDownstreamSpeed(null as any)).toBe(0);
      expect(getShelfDownstreamSpeed({ x: NaN, y: 0, z: 0 })).toBe(0);
    });
  });

  describe('computeShelfLaunchImpulse', () => {
    it('produces a forward+up impulse scaled by vehicle multiplier', () => {
      const result = computeShelfLaunchImpulse(1.0);
      expect(result.impulse.z).toBeLessThan(0);
      expect(result.impulse.y).toBeGreaterThan(0);
      expect(result.impulse.x).toBeCloseTo(0, 5);

      const scaled = computeShelfLaunchImpulse(0.5);
      expect(scaled.impulse.y).toBeCloseTo(result.impulse.y * 0.5, 5);
      expect(Math.abs(scaled.impulse.z)).toBeCloseTo(Math.abs(result.impulse.z) * 0.5, 5);
    });
  });

  describe('tryFireShelfLaunch', () => {
    const makeTrigger = (): ShelfTrigger => ({
      center: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 },
      halfWidth: 10,
      halfHeight: 10,
      halfLength: 10,
    });

    it('fires only on segment 14', () => {
      const firedRef = { current: false };
      const result = tryFireShelfLaunch({
        currentSegmentIndex: 13,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: -20 },
        trigger: makeTrigger(),
        firedRef,
        speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
        vehicleScale: 1,
      });
      expect(result).toBeNull();
      expect(firedRef.current).toBe(false);
    });

    it('fires only when speed is above threshold', () => {
      const firedRef = { current: false };
      const result = tryFireShelfLaunch({
        currentSegmentIndex: 14,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: -2 },
        trigger: makeTrigger(),
        firedRef,
        speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
        vehicleScale: 1,
      });
      expect(result).toBeNull();
      expect(firedRef.current).toBe(false);
    });

    it('fires only when inside the trigger box', () => {
      const firedRef = { current: false };
      const result = tryFireShelfLaunch({
        currentSegmentIndex: 14,
        position: { x: 100, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: -20 },
        trigger: makeTrigger(),
        firedRef,
        speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
        vehicleScale: 1,
      });
      expect(result).toBeNull();
      expect(firedRef.current).toBe(false);
    });

    it('fires and sets the one-shot flag when all conditions are met', () => {
      const firedRef = { current: false };
      const result = tryFireShelfLaunch({
        currentSegmentIndex: 14,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: -20 },
        trigger: makeTrigger(),
        firedRef,
        speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
        vehicleScale: 1,
      });
      expect(result).not.toBeNull();
      expect(firedRef.current).toBe(true);
    });

    it('is one-shot: second call returns null even when still inside and fast', () => {
      const firedRef = { current: false };
      const args = {
        currentSegmentIndex: 14,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: -20 },
        trigger: makeTrigger(),
        firedRef,
        speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
        vehicleScale: 1,
      };
      expect(tryFireShelfLaunch(args)).not.toBeNull();
      expect(tryFireShelfLaunch(args)).toBeNull();
    });

    it('resets the one-shot flag when leaving segment 14', () => {
      const firedRef = { current: false };
      const args = {
        currentSegmentIndex: 14,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: -20 },
        trigger: makeTrigger(),
        firedRef,
        speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
        vehicleScale: 1,
      };
      expect(tryFireShelfLaunch(args)).not.toBeNull();
      tryFireShelfLaunch({ ...args, currentSegmentIndex: 15 });
      expect(firedRef.current).toBe(false);
    });
  });
});
