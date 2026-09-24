/**
 * Reach Validator — safeZone.respawnAt rules (mirrors levelValidator).
 */

import { describe, expect, it } from 'vitest';
import { validateReach } from './reachValidator';

const createValidReach = () => ({
  reachId: 'test-reach',
  metadata: {
    name: 'Test Reach',
    author: 'Test Author',
    difficulty: 'beginner',
    estimatedDuration: 120,
    version: '1.0.0',
  },
  world: {
    track: {
      waypoints: [
        [0, 0, 0],
        [0, -5, -30],
        [10, -10, -80],
        [-5, -15, -140],
      ],
      segmentLength: 30,
      totalSegments: 3,
    },
    biome: {
      baseType: 'canyonSummer',
      sky: { color: '#87CEEB' },
      fog: { color: '#D4E9F7', near: 50, far: 200 },
      lighting: { sunIntensity: 1.4, sunAngle: 45 },
      water: { tint: '#1a6b8a', flowSpeed: 1.0 },
    },
  },
  segments: [
    { index: 0, difficulty: 0.3, decorations: { trees: 10 } },
    { index: 1, difficulty: 0.4, decorations: { trees: 12 } },
    { index: 2, difficulty: 0.5, decorations: { trees: 8 } },
  ] as Array<Record<string, unknown>>,
  spawns: { start: { position: [0, -4, 5] } },
  requiredAssets: { textures: [], models: [], audio: [], shaders: [] },
  transition: { segmentIndex: 2, type: 'waterfall', durationSeconds: 5 },
});

const withSafeZone = (safeZone: Record<string, number>, index = 2) => {
  const reach = createValidReach();
  reach.segments = reach.segments.map((seg) => (seg.index === index ? { ...seg, safeZone } : seg));
  return reach;
};

const respawnErrors = (reach: unknown, index = 2) =>
  validateReach(reach).errors.filter((e) => e.field === `segments[${index}].safeZone.respawnAt`);

describe('reachValidator — safeZone', () => {
  it('accepts the fixture and a respawnAt on an upstream segment or itself', () => {
    expect(validateReach(createValidReach()).errors).toEqual([]);
    expect(validateReach(withSafeZone({ yMin: -12, yMax: 150, respawnAt: 0 })).valid).toBe(true);
    expect(validateReach(withSafeZone({ yMin: -12, yMax: 150, respawnAt: 2 })).valid).toBe(true);
  });

  it('rejects a non-integer respawnAt', () => {
    const errors = respawnErrors(withSafeZone({ yMin: -12, yMax: 150, respawnAt: 0.5 }));
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/integer/);
  });

  it('rejects a respawnAt that names no segment in the reach', () => {
    const errors = respawnErrors(withSafeZone({ yMin: -12, yMax: 150, respawnAt: 7 }, 2));
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/does not name a segment/);
  });

  it('rejects a respawnAt downstream of its segment', () => {
    const errors = respawnErrors(withSafeZone({ yMin: -12, yMax: 150, respawnAt: 2 }, 1), 1);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/downstream/);
  });

  it('still rejects an inverted or absolute-looking envelope', () => {
    const fields = validateReach(withSafeZone({ yMin: 5, yMax: 2 })).errors.map((e) => e.field);
    expect(fields).toContain('segments[2].safeZone');
  });
});
