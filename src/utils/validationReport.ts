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
  value?: any;
  lineNum?: number;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

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
