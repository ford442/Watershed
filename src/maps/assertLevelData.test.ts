import { describe, expect, it } from 'vitest';
import { assertLevelData } from './assertLevelData';
import { KNOWN_LEVEL_SCHEMA_DEBT } from './levelSchemaDebt';
import meanderLevel from './meander_to_waterfall.json';

describe('assertLevelData', () => {
  it('accepts production meander map (only documented schema debt)', () => {
    expect(() => assertLevelData(meanderLevel, 'meander')).not.toThrow();
    expect(assertLevelData(meanderLevel, 'meander')).toBe(meanderLevel);
  });

  it('rejects new schema violations outside the debt list', () => {
    const level = {
      metadata: { name: 'bad', version: '1.0.0' },
      world: {
        track: {
          waypoints: [[0, 0, 0]],
          segmentLength: 40,
        },
        biome: { baseType: 'canyonSummer' },
      },
      segments: [{ index: 0, difficulty: 0.2, decorations: {} }],
      spawns: { start: { position: [0, 10, -10] } },
    };

    expect(() => assertLevelData(level, 'bad fixture')).toThrow(/failed level validation/);
  });

  it('has no documented debt — all shipped maps fully validate under ajv', () => {
    expect(KNOWN_LEVEL_SCHEMA_DEBT.length).toBe(0);
  });
});
