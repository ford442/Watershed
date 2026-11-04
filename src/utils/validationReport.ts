/**
 * Validation result shape + report formatter shared by levelValidator and reachValidator.
 *
 * Split out so boot-path code (useLevel, ReachStreamer) can type and format results
 * without statically importing the precompiled schema validators, which load on demand
 * (#485 follow-up: ~237 kB raw off the entry chunk).
 */

export interface ValidationError {
  field: string;
  error: string;
  value?: unknown;
  lineNum?: number;
  suggestion?: string;
}

/**
 * A validator's report. `T` is the shape a pass guarantees: a valid result hands the input
 * back as `data: T` (narrowed from the `unknown` the loader parsed), an invalid one has
 * `data: null`, so no caller needs to cast parsed JSON.
 */
export type ValidationResult<T = unknown> =
  | { valid: true; errors: ValidationError[]; warnings: ValidationError[]; data: T }
  | { valid: false; errors: ValidationError[]; warnings: ValidationError[]; data: null };

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
