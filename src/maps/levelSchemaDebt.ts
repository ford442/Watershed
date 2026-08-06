/**
 * Documented schema debt shared between registry load-time validation and
 * `registry.contract.test.ts`. New violations outside this list fail CI.
 */
export const KNOWN_LEVEL_SCHEMA_DEBT: readonly string[] = [
  // Authored segments routinely omit `decorations` and fall back to biome defaults.
  "segments.*.decorations :: must have required property 'decorations'",
  // meander_to_waterfall uses negative indices for pre-roll segments ahead of index 0.
  'segments.*.index :: must be >= 0',
];

/** Collapse array indices so one debt entry covers every offending segment. */
export function levelErrorSignature(field: string, error: string): string {
  return `${field.replace(/\.\d+\./g, '.*.')} :: ${error}`;
}

export function filterUnexpectedLevelErrors(
  errors: Array<{ field: string; error: string }>,
): string[] {
  const unexpected = errors
    .map((err) => levelErrorSignature(err.field, err.error))
    .filter((signature) => !KNOWN_LEVEL_SCHEMA_DEBT.includes(signature));
  return [...new Set(unexpected)];
}
