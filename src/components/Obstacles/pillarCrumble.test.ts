import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VEHICLE_TUNING } from '../../constants/vehicleTuning';
import {
  buildPillarFragments,
  evaluatePillarImpact,
  horizontalSpeed,
  PILLAR_CRUMBLE_SPEED_THRESHOLD,
} from './pillarCrumble';

describe('pillarCrumble', () => {
  describe('evaluatePillarImpact', () => {
    it('rejects impacts below the speed threshold', () => {
      const result = evaluatePillarImpact({
        playerSpeed: PILLAR_CRUMBLE_SPEED_THRESHOLD - 0.1,
        phase: 'intact',
      });
      expect(result.shouldCrack).toBe(false);
      expect(result.reason).toBe('too_slow');
    });

    it('accepts high-speed impacts on intact pillars', () => {
      const result = evaluatePillarImpact({
        playerSpeed: PILLAR_CRUMBLE_SPEED_THRESHOLD + 2,
        phase: 'intact',
      });
      expect(result.shouldCrack).toBe(true);
      expect(result.reason).toBe('ok');
    });

    it('ignores contacts once the pillar is already cracking or shattered', () => {
      expect(evaluatePillarImpact({ playerSpeed: 20, phase: 'cracking' }).reason).toBe('already_broken');
      expect(evaluatePillarImpact({ playerSpeed: 20, phase: 'shattered' }).reason).toBe('already_broken');
    });

    it('uses the same threshold source as vehicle tuning', () => {
      expect(PILLAR_CRUMBLE_SPEED_THRESHOLD).toBe(VEHICLE_TUNING.pillarCrumble.speedThreshold);
    });
  });

  describe('buildPillarFragments', () => {
    it('returns the requested fragment count with impulses', () => {
      const center = new THREE.Vector3(1, 2, 3);
      const columnScale = new THREE.Vector3(2, 3, 2);
      const impactDir = new THREE.Vector3(0, 0, -1);
      const fragments = buildPillarFragments({
        center,
        columnScale,
        impactDir,
        seed: 22,
        count: 8,
      });

      expect(fragments).toHaveLength(8);
      fragments.forEach((frag) => {
        expect(frag.impulse.length()).toBeGreaterThan(0);
        expect(frag.scale.x).toBeGreaterThan(0);
      });
    });

    it('is deterministic for the same seed', () => {
      const args = {
        center: new THREE.Vector3(0, 0, 0),
        columnScale: new THREE.Vector3(2, 2, 2),
        impactDir: new THREE.Vector3(1, 0, 0),
        seed: 99,
        count: 6,
      };
      const a = buildPillarFragments(args);
      const b = buildPillarFragments(args);
      expect(a.map((f) => f.position.toArray())).toEqual(b.map((f) => f.position.toArray()));
    });
  });

  describe('horizontalSpeed', () => {
    it('ignores vertical velocity', () => {
      expect(horizontalSpeed({ x: 3, y: 50, z: 4 })).toBe(5);
    });
  });
});
