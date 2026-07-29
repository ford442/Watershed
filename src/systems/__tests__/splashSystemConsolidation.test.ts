/**
 * SplashSystem consolidation — mount wiring + spawn-gate helpers.
 * No R3F mount required.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  cruiseSplashCount,
  detectWaterContactEdge,
  entryExitSplashCount,
  mistSpawnCount,
  resolveSplashFrameEvents,
  raftSubmergedRatio,
  CRUISE_MIN_SPEED,
  MIST_MIN_SPEED,
  MIST_MIN_SUBMERGED,
} from '../splashSpawnMath';

describe('SplashSystem consolidation', () => {
  describe('WaterStack mount wiring', () => {
    const waterStackPath = path.join(
      __dirname,
      '../../experience/WaterStack.tsx',
    );
    const source = fs.readFileSync(waterStackPath, 'utf8');

    it('does not import or reference WaterInteraction', () => {
      expect(source).not.toMatch(/WaterInteraction/);
    });

    it('mounts SplashSystem exactly once in WaterPhysicsEffects', () => {
      const physicsBlock = source.slice(
        source.indexOf('export function WaterPhysicsEffects'),
        source.indexOf('export default function WaterStack'),
      );
      const mounts = physicsBlock.match(/<SplashSystem\b/g) ?? [];
      expect(mounts).toHaveLength(1);
      expect(physicsBlock).toMatch(/isRaft=\{vehicleType === 'raft'\}/);
    });
  });

  describe('detectWaterContactEdge', () => {
    it('detects entry and exit edges', () => {
      expect(detectWaterContactEdge(false, true)).toBe('entry');
      expect(detectWaterContactEdge(true, false)).toBe('exit');
      expect(detectWaterContactEdge(true, true)).toBe('none');
      expect(detectWaterContactEdge(false, false)).toBe('none');
    });
  });

  describe('cruiseSplashCount', () => {
    it('returns 0 below min speed', () => {
      expect(cruiseSplashCount(CRUISE_MIN_SPEED, 15, 1, 1)).toBe(0);
      expect(cruiseSplashCount(0.5, 15, 1, 1)).toBe(0);
    });

    it('scales with speed, flowSpeed, and particleDensity', () => {
      const low = cruiseSplashCount(5, 15, 1, 0.4);
      const mid = cruiseSplashCount(5, 15, 1, 1);
      const high = cruiseSplashCount(15, 15, 1.5, 1.5);
      expect(mid).toBeGreaterThan(low);
      expect(high).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(0);
    });
  });

  describe('mistSpawnCount', () => {
    it('gates on isRaft, submerged ratio, and speed', () => {
      expect(mistSpawnCount(false, 1, 10, 1, 1)).toBe(0);
      expect(mistSpawnCount(true, MIST_MIN_SUBMERGED - 0.1, 10, 1, 1)).toBe(0);
      expect(mistSpawnCount(true, 1, MIST_MIN_SPEED, 1, 1)).toBe(0);
      expect(mistSpawnCount(true, 1, 7, 1, 1)).toBeGreaterThan(0);
    });
  });

  describe('resolveSplashFrameEvents — no double-spawn on edge', () => {
    it('fires entry splash and suppresses cruise on the same frame', () => {
      const events = resolveSplashFrameEvents(
        false, // wasInWater
        true, // isInWater — entry edge
        true, // isNearWater
        10, // speed high enough for cruise
        15,
        1,
        1,
        0, // cooldown ready
      );
      expect(events.entrySplash).toBe(true);
      expect(events.exitSplash).toBe(false);
      expect(events.cruiseCount).toBe(0);
      expect(events.foamEligible).toBe(false);
    });

    it('fires exit splash and suppresses cruise on the same frame', () => {
      const events = resolveSplashFrameEvents(
        true,
        false,
        true,
        10,
        15,
        1,
        1,
        0,
      );
      expect(events.exitSplash).toBe(true);
      expect(events.entrySplash).toBe(false);
      expect(events.cruiseCount).toBe(0);
    });

    it('allows cruise when near water with no edge and cooldown ready', () => {
      const events = resolveSplashFrameEvents(
        true,
        true,
        true,
        8,
        15,
        1,
        1,
        0,
      );
      expect(events.edge).toBe('none');
      expect(events.cruiseCount).toBeGreaterThan(0);
      expect(events.foamEligible).toBe(true);
    });

    it('suppresses cruise while cooldown remains', () => {
      const events = resolveSplashFrameEvents(
        true,
        true,
        true,
        8,
        15,
        1,
        1,
        0.05,
      );
      expect(events.cruiseCount).toBe(0);
    });
  });

  describe('helpers', () => {
    it('raftSubmergedRatio clamps to [0, 1]', () => {
      expect(raftSubmergedRatio(10, 0.5)).toBe(0);
      expect(raftSubmergedRatio(0.5, 0.5)).toBeGreaterThan(0);
      expect(raftSubmergedRatio(-10, 0.5)).toBe(1);
    });

    it('entryExitSplashCount scales with intensity and density', () => {
      expect(entryExitSplashCount(1, 1)).toBe(25);
      expect(entryExitSplashCount(0.5, 1)).toBe(17);
      expect(entryExitSplashCount(1, 0.4)).toBeLessThan(
        entryExitSplashCount(1, 1),
      );
    });
  });
});
