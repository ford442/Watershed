/**
 * Level Validator Utility
 * 
 * Validates Watershed Level Format (WLF) JSON files against the schema
 * and performs additional semantic validation.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as THREE from 'three';

// Import the JSON schema
import levelSchema from '../formats/level.schema.json';

// Initialize AJV
const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

// Compile schema
const validateSchema = ajv.compile(levelSchema);

// Validation result type
export interface ValidationError {
  field: string;
  error: string;
  value?: any;
  lineNum?: number;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// Biome type mapping
const BIOME_TYPES = [
  'creek-summer',
  'creek-autumn',
  'alpine-spring',
  'canyon-sunset',
  'midnight-mist'
];

// Segment type mapping
const SEGMENT_TYPES = ['normal', 'waterfall', 'pond', 'splash', 'rapids'];

// Difficulty mapping
const DIFFICULTY_TYPES = ['beginner', 'intermediate', 'expert', 'custom'];

// Numeric ranges for validation
const RANGES = {
  difficulty: { min: 0, max: 1 },
  segmentLength: { min: 20, max: 50 },
  totalSegments: { min: 1, max: 50 },
  width: { min: 20, max: 80 },
  wallHeight: { min: 8, max: 20 },
  meanderStrength: { min: 0, max: 3 },
  verticalBias: { min: -3, max: 0 },
  forwardMomentum: { min: 0.1, max: 2 },
  gravityMultiplier: { min: 0.5, max: 2 },
  waterFlowIntensity: { min: 0, max: 3 },
  sunIntensity: { min: 0.5, max: 2 },
  ambientIntensity: { min: 0.1, max: 1 },
  flowSpeed: { min: 0, max: 3 },
};

// Decoration limits
const DECORATION_LIMITS: Record<string, { min: number; max: number }> = {
  trees: { min: 0, max: 50 },
  grass: { min: 0, max: 100 },
  rocks: { min: 0, max: 30 },
  wildflowers: { min: 0, max: 50 },
  ferns: { min: 0, max: 40 },
  mushrooms: { min: 0, max: 30 },
  reeds: { min: 0, max: 40 },
  driftwood: { min: 0, max: 30 },
  pebbles: { min: 0, max: 60 },
  pinecones: { min: 0, max: 40 },
  fireflies: { min: 0, max: 20 },
  birds: { min: 0, max: 15 },
  fish: { min: 0, max: 20 },
  dragonflies: { min: 0, max: 15 },
  fallingLeaves: { min: 0, max: 30 },
  floatingLeaves: { min: 0, max: 20 },
  mist: { min: 0, max: 15 },
  waterLilies: { min: 0, max: 20 },
  sunShafts: { min: 0, max: 10 },
  rapids: { min: 0, max: 20 },
};

/**
 * Main validation function
 */
export function validateLevel(levelData: any): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // 1. Schema validation
  const schemaValid = validateSchema(levelData);
  if (!schemaValid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      errors.push({
        field: err.instancePath || 'root',
        error: err.message || 'Invalid value',
        value: err.data,
        suggestion: getSuggestionForError(err),
      });
    }
  }

  // 2. Semantic validation (only if basic structure is valid)
  if (schemaValid) {
    validateSemantics(levelData, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Semantic validation beyond JSON schema
 */
function validateSemantics(levelData: any, errors: ValidationError[], warnings: ValidationError[]): void {
  const { metadata, world, segments, spawns } = levelData;

  // Validate waypoints
  if (world?.track?.waypoints) {
    validateWaypoints(world.track.waypoints, errors, warnings);
  }

  // Validate segments count matches totalSegments
  if (world?.track?.totalSegments !== undefined && segments) {
    if (segments.length !== world.track.totalSegments) {
      errors.push({
        field: 'segments',
        error: `Segment count (${segments.length}) doesn't match totalSegments (${world.track.totalSegments})`,
        suggestion: `Set totalSegments to ${segments.length} or add/remove segments`,
      });
    }

    // Validate segment indices
    const indices = new Set<number>();
    for (const seg of segments) {
      if (indices.has(seg.index)) {
        errors.push({
          field: `segments[${seg.index}].index`,
          error: `Duplicate segment index: ${seg.index}`,
          suggestion: 'Ensure each segment has a unique index',
        });
      }
      indices.add(seg.index);
    }

    // Check for gaps
    for (let i = 0; i < world.track.totalSegments; i++) {
      if (!indices.has(i)) {
        errors.push({
          field: 'segments',
          error: `Missing segment with index ${i}`,
          suggestion: `Add a segment with index ${i}`,
        });
      }
    }
  }

  // Validate biome references
  if (world?.biome?.baseType) {
    if (!BIOME_TYPES.includes(world.biome.baseType)) {
      errors.push({
        field: 'world.biome.baseType',
        error: `Unknown biome type: ${world.biome.baseType}`,
        suggestion: `Use one of: ${BIOME_TYPES.join(', ')}`,
      });
    }
  }

  // Validate segment biome overrides
  if (segments) {
    for (const seg of segments) {
      if (seg.biomeOverride && !BIOME_TYPES.includes(seg.biomeOverride)) {
        errors.push({
          field: `segments[${seg.index}].biomeOverride`,
          error: `Unknown biome type: ${seg.biomeOverride}`,
          suggestion: `Use one of: ${BIOME_TYPES.join(', ')}`,
        });
      }
    }
  }

  // Validate checkpoints reference valid segments
  if (spawns?.checkpoints) {
    for (let i = 0; i < spawns.checkpoints.length; i++) {
      const cp = spawns.checkpoints[i];
      if (cp.segment >= (world?.track?.totalSegments || 0)) {
        errors.push({
          field: `spawns.checkpoints[${i}].segment`,
          error: `Checkpoint references invalid segment ${cp.segment}`,
          suggestion: `Use a segment index between 0 and ${(world?.track?.totalSegments || 1) - 1}`,
        });
      }
    }
  }

  // Validate fog near/far relationship
  if (world?.biome?.fog) {
    const { near, far } = world.biome.fog;
    if (near >= far) {
      errors.push({
        field: 'world.biome.fog',
        error: 'Fog near value must be less than far value',
        suggestion: `Set near < far (currently near=${near}, far=${far})`,
      });
    }
  }

  // Validate safe zones
  if (segments) {
    for (const seg of segments) {
      if (seg.safeZone) {
        if (seg.safeZone.yMin >= seg.safeZone.yMax) {
          errors.push({
            field: `segments[${seg.index}].safeZone`,
            error: 'yMin must be less than yMax',
            suggestion: `Adjust values so yMin < yMax`,
          });
        }
      }
    }
  }

  // Warnings for unusual values
  if (metadata?.estimatedDuration > 600) {
    warnings.push({
      field: 'metadata.estimatedDuration',
      error: 'Very long estimated duration (>10 minutes)',
      suggestion: 'Consider splitting into multiple levels',
    });
  }

  if (world?.track?.totalSegments > 20) {
    warnings.push({
      field: 'world.track.totalSegments',
      error: 'Large number of segments may impact performance',
      suggestion: 'Consider reducing to 15-20 segments for better performance',
    });
  }
}

/**
 * Validate waypoint geometry
 */
function validateWaypoints(waypoints: number[][], errors: ValidationError[], warnings: ValidationError[]): void {
  if (waypoints.length < 4) {
    errors.push({
      field: 'world.track.waypoints',
      error: `At least 4 waypoints required, found ${waypoints.length}`,
      suggestion: 'Add more waypoints to define a complete curve',
    });
    return;
  }

  // Check for duplicate points
  const seen = new Set<string>();
  for (let i = 0; i < waypoints.length; i++) {
    const [x, y, z] = waypoints[i];
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    if (seen.has(key)) {
      errors.push({
        field: `world.track.waypoints[${i}]`,
        error: `Duplicate waypoint position: [${x}, ${y}, ${z}]`,
        suggestion: 'Move the waypoint to a unique position',
      });
    }
    seen.add(key);

    // Check distance to previous point
    if (i > 0) {
      const prev = waypoints[i - 1];
      const dist = Math.sqrt(
        Math.pow(x - prev[0], 2) +
        Math.pow(y - prev[1], 2) +
        Math.pow(z - prev[2], 2)
      );

      if (dist < 20) {
        warnings.push({
          field: `world.track.waypoints[${i}]`,
          error: `Waypoint very close to previous (${dist.toFixed(1)} units)`,
          suggestion: 'Increase distance to at least 20 units for smoother curves',
        });
      }

      if (dist > 150) {
        warnings.push({
          field: `world.track.waypoints[${i}]`,
          error: `Waypoint very far from previous (${dist.toFixed(1)} units)`,
          suggestion: 'Add intermediate waypoints for smoother curves',
        });
      }

      // Check downhill trend
      if (y > prev[1] + 5) {
        warnings.push({
          field: `world.track.waypoints[${i}]`,
          error: `Waypoint ${i} is significantly uphill from previous`,
          suggestion: 'Y values should generally decrease for natural water flow',
        });
      }
    }
  }

  // Test curve for self-intersection (simplified)
  try {
    const points = waypoints.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
    
    // Sample points along curve to detect potential self-intersection
    const samples = 100;
    const samplePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      samplePoints.push(curve.getPoint(i / samples));
    }

    // Check for nearby points that aren't consecutive
    for (let i = 0; i < samplePoints.length; i++) {
      for (let j = i + 10; j < samplePoints.length; j++) {
        const dist = samplePoints[i].distanceTo(samplePoints[j]);
        if (dist < 5) {
          warnings.push({
            field: 'world.track.waypoints',
            error: `Track curve may self-intersect near sample points ${i} and ${j}`,
            suggestion: 'Adjust waypoints to create a non-intersecting path',
          });
          // Only report first intersection
          return;
        }
      }
    }
  } catch (e) {
    errors.push({
      field: 'world.track.waypoints',
      error: 'Failed to validate curve geometry',
      suggestion: 'Check that all waypoints are valid 3D coordinates',
    });
  }
}

/**
 * Get human-readable suggestion for common schema errors
 */
function getSuggestionForError(error: any): string | undefined {
  const path = error.instancePath || '';
  const message = error.message || '';

  if (message.includes('must match pattern')) {
    if (path.includes('color')) {
      return 'Use hex format: #RRGGBB (e.g., #87CEEB)';
    }
    if (path.includes('version')) {
      return 'Use semantic versioning: X.Y.Z (e.g., 1.0.0)';
    }
  }

  if (message.includes('must be equal to constant')) {
    if (path.includes('biome')) {
      return `Valid biomes: ${BIOME_TYPES.join(', ')}`;
    }
    if (path.includes('type')) {
      return `Valid segment types: ${SEGMENT_TYPES.join(', ')}`;
    }
    if (path.includes('difficulty')) {
      return `Valid difficulties: ${DIFFICULTY_TYPES.join(', ')}`;
    }
  }

  if (message.includes('must be number')) {
    return 'Provide a numeric value (no quotes)';
  }

  if (message.includes('must be array')) {
    return 'Provide an array: [item1, item2, ...]';
  }

  if (message.includes('must be object')) {
    return 'Provide an object: { "key": "value" }';
  }

  if (message.includes('must have required property')) {
    const missingProp = message.match(/property '(\w+)'/)?.[1];
    if (missingProp) {
      return `Add the required field: "${missingProp}"`;
    }
  }

  if (message.includes('must NOT have fewer than')) {
    if (path.includes('waypoints')) {
      return 'Add at least 4 waypoints to define the track path';
    }
  }

  if (message.includes('must be <= ')) {
    const max = message.match(/must be <= (\d+\.?\d*)/)?.[1];
    return `Value exceeds maximum of ${max}`;
  }

  if (message.includes('must be >= ')) {
    const min = message.match(/must be >= (\d+\.?\d*)/)?.[1];
    return `Value is below minimum of ${min}`;
  }

  return undefined;
}

/**
 * Quick validation for decoration counts
 */
export function validateDecorationCount(type: string, count: number): { valid: boolean; message?: string } {
  const limits = DECORATION_LIMITS[type];
  if (!limits) {
    return { valid: false, message: `Unknown decoration type: ${type}` };
  }

  if (count < limits.min || count > limits.max) {
    return {
      valid: false,
      message: `${type} count must be between ${limits.min} and ${limits.max}`,
    };
  }

  return { valid: true };
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) {
    return result.warnings.length > 0
      ? `Valid with ${result.warnings.length} warning(s)`
      : 'Valid!';
  }

  const lines: string[] = [`Found ${result.errors.length} error(s):`];
  
  for (const err of result.errors) {
    lines.push(`  • ${err.field}: ${err.error}`);
    if (err.suggestion) {
      lines.push(`    → ${err.suggestion}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`\n${result.warnings.length} warning(s):`);
    for (const warn of result.warnings) {
      lines.push(`  • ${warn.field}: ${warn.error}`);
    }
  }

  return lines.join('\n');
}

export default validateLevel;
