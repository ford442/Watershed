/**
 * Level Validator Tests
 */

import { validateLevel, validateDecorationCount, formatValidationErrors, ValidationResult } from './levelValidator';

// Test helper
const createValidLevel = () => ({
  metadata: {
    name: 'Test Level',
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
      baseType: 'creek-summer',
      sky: { color: '#87CEEB' },
      fog: { color: '#D4E9F7', near: 50, far: 200 },
      lighting: { sunIntensity: 1.4, sunAngle: 45 },
      water: { tint: '#1a6b8a', flowSpeed: 1.0 },
    },
  },
  segments: [
    {
      index: 0,
      difficulty: 0.3,
      decorations: { trees: 10 },
    },
    {
      index: 1,
      difficulty: 0.4,
      decorations: { trees: 12 },
    },
    {
      index: 2,
      difficulty: 0.5,
      decorations: { trees: 8 },
    },
  ],
  spawns: {
    start: { position: [0, -4, 5] },
  },
});

describe('Level Validator', () => {
  describe('Basic Validation', () => {
    it('should validate a correct level', () => {
      const level = createValidLevel();
      const result = validateLevel(level);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when metadata is missing', () => {
      const level = { ...createValidLevel(), metadata: undefined };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field.includes('metadata'))).toBe(true);
    });

    it('should fail when required fields are missing', () => {
      const level = {
        ...createValidLevel(),
        metadata: { name: 'Test' }, // Missing author, difficulty, etc.
      };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
    });

    it('should fail with invalid version format', () => {
      const level = {
        ...createValidLevel(),
        metadata: { ...createValidLevel().metadata, version: 'invalid' },
      };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
    });
  });

  describe('Waypoints Validation', () => {
    it('should fail with fewer than 4 waypoints', () => {
      const level = {
        ...createValidLevel(),
        world: {
          ...createValidLevel().world,
          track: {
            ...createValidLevel().world.track,
            waypoints: [[0, 0, 0], [0, -5, -30]],
          },
        },
      };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
    });

    it('should warn about duplicate waypoints', () => {
      const level = {
        ...createValidLevel(),
        world: {
          ...createValidLevel().world,
          track: {
            ...createValidLevel().world.track,
            waypoints: [
              [0, 0, 0],
              [0, 0, 0], // Duplicate
              [10, -10, -80],
              [-5, -15, -140],
            ],
          },
        },
      };
      const result = validateLevel(level);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Segment Validation', () => {
    it('should fail when segment count does not match totalSegments', () => {
      const level = {
        ...createValidLevel(),
        world: {
          ...createValidLevel().world,
          track: {
            ...createValidLevel().world.track,
            totalSegments: 5, // Says 5
          },
        },
        // But only provides 3 segments
      };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.error.includes("doesn't match"))).toBe(true);
    });

    it('should fail with duplicate segment indices', () => {
      const level = {
        ...createValidLevel(),
        segments: [
          { index: 0, difficulty: 0.3, decorations: {} },
          { index: 0, difficulty: 0.4, decorations: {} }, // Duplicate
          { index: 2, difficulty: 0.5, decorations: {} },
        ],
      };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.error.includes('Duplicate'))).toBe(true);
    });

    it('should fail with invalid biome override', () => {
      const level = {
        ...createValidLevel(),
        segments: [
          {
            index: 0,
            difficulty: 0.3,
            decorations: {},
            biomeOverride: 'invalid-biome',
          },
        ],
      };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
    });
  });

  describe('Decoration Validation', () => {
    it('should validate decoration counts', () => {
      expect(validateDecorationCount('trees', 25).valid).toBe(true);
      expect(validateDecorationCount('trees', 100).valid).toBe(false);
      expect(validateDecorationCount('trees', -5).valid).toBe(false);
    });

    it('should reject unknown decoration types', () => {
      const result = validateDecorationCount('unknown', 10);
      expect(result.valid).toBe(false);
    });
  });

  describe('Fog Validation', () => {
    it('should fail when fog near >= far', () => {
      const level = {
        ...createValidLevel(),
        world: {
          ...createValidLevel().world,
          biome: {
            ...createValidLevel().world.biome,
            fog: { color: '#FFFFFF', near: 200, far: 100 },
          },
        },
      };
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field.includes('fog'))).toBe(true);
    });
  });

  describe('Format Helpers', () => {
    it('should format valid result', () => {
      const result: ValidationResult = { valid: true, errors: [], warnings: [] };
      expect(formatValidationErrors(result)).toBe('Valid!');
    });

    it('should format result with warnings', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [{ field: 'test', error: 'Test warning' }],
      };
      expect(formatValidationErrors(result)).toContain('1 warning');
    });

    it('should format result with errors', () => {
      const result: ValidationResult = {
        valid: false,
        errors: [
          { field: 'field1', error: 'Error 1', suggestion: 'Fix 1' },
          { field: 'field2', error: 'Error 2' },
        ],
        warnings: [],
      };
      const formatted = formatValidationErrors(result);
      expect(formatted).toContain('2 error');
      expect(formatted).toContain('field1');
      expect(formatted).toContain('Fix 1');
    });
  });
});

export {};
