/**
 * levelEditorValidator.ts
 *
 * Validation logic for the Level Editor.
 * Distinct from levelValidator.ts (which uses AJV for runtime loading).
 * Do NOT import levelValidator.ts here.
 */

import type { EditorSegmentConfig } from '../hooks/useLevelEditor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorValidationError {
  type: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  segmentId?: string;
  /** Dotted field path, e.g. "segments[2].difficulty" */
  field?: string;
  autoFixable: boolean;
  /** Optional human-readable fix suggestion */
  suggestion?: string;
}

export interface EditorValidationResult {
  valid: boolean;
  errors: EditorValidationError[];
  warnings: EditorValidationError[];
  infos: EditorValidationError[];
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateEditorLevel(
  segments: EditorSegmentConfig[],
): EditorValidationResult {
  const errors: EditorValidationError[] = [];
  const warnings: EditorValidationError[] = [];
  const infos: EditorValidationError[] = [];

  if (segments.length === 0) {
    errors.push({
      type: 'error',
      code: 'NO_SEGMENTS',
      message: 'Level must have at least one segment.',
      autoFixable: false,
    });
    return { valid: false, errors, warnings, infos };
  }

  for (const seg of segments) {
    const segId = seg.id;

    // difficulty in [0, 1]
    if (seg.difficulty < 0 || seg.difficulty > 1) {
      errors.push({
        type: 'error',
        code: 'INVALID_DIFFICULTY',
        message: `Segment ${seg.index}: difficulty ${seg.difficulty.toFixed(2)} is outside [0, 1].`,
        segmentId: segId,
        field: `segments[${seg.index}].difficulty`,
        autoFixable: true,
        suggestion: 'Clamp difficulty to the range [0, 1].',
      });
    }

    // width must be positive when defined
    if (seg.width !== undefined && seg.width <= 0) {
      errors.push({
        type: 'error',
        code: 'INVALID_WIDTH',
        message: `Segment ${seg.index}: width must be > 0 (got ${seg.width}).`,
        segmentId: segId,
        field: `segments[${seg.index}].width`,
        autoFixable: true,
        suggestion: 'Set width to a positive value (e.g. 35).',
      });
    }

    // negative meander is unusual
    if (seg.meanderAmount < 0) {
      warnings.push({
        type: 'warning',
        code: 'NEGATIVE_MEANDER',
        message: `Segment ${seg.index}: meanderAmount is negative (${seg.meanderAmount.toFixed(2)}).`,
        segmentId: segId,
        field: `segments[${seg.index}].meanderAmount`,
        autoFixable: true,
        suggestion: 'Negative meander amount may cause unexpected path curvature.',
      });
    }

    // zero length is a degenerate segment
    if (seg.length <= 0) {
      warnings.push({
        type: 'warning',
        code: 'ZERO_LENGTH',
        message: `Segment ${seg.index}: computed length is ${seg.length.toFixed(1)} — the segment may be degenerate.`,
        segmentId: segId,
        field: `segments[${seg.index}].length`,
        autoFixable: false,
        suggestion: 'Ensure the track waypoints span a meaningful distance.',
      });
    }
  }

  // Info: suggest adding a waterfall for longer levels
  const hasWaterfall = segments.some((s) => s.type === 'waterfall');
  if (!hasWaterfall && segments.length >= 10) {
    infos.push({
      type: 'info',
      code: 'NO_WATERFALL',
      message: 'No waterfall segment found. Consider adding one for visual variety.',
      autoFixable: false,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    infos,
  };
}
