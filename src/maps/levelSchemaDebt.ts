/**
 * Documented schema debt shared between registry load-time validation and
 * `registry.contract.test.ts`. New violations outside this list fail CI.
 *
 * Empty: authored maps emit explicit `decorations` where needed, and
 * `level.schema.json` legalizes negative pre-roll segment indices (down to -10).
 */
export const KNOWN_LEVEL_SCHEMA_DEBT: readonly string[] = [];

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
