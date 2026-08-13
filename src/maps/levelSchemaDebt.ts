import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import levelSchema from '../formats/level.schema.json';

/**
 * Documented schema debt shared between registry load-time validation and
 * `registry.contract.test.ts`. New violations outside this list fail CI.
 */
export const KNOWN_LEVEL_SCHEMA_DEBT: readonly string[] = [];

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);
const validateSchema = ajv.compile(levelSchema);

function schemaErrorField(error: ErrorObject): string {
  const path = error.instancePath
    ? error.instancePath.replace(/^\//, '').replace(/\//g, '.')
    : '';

  if (error.keyword === 'required') {
    const missingProp = error.params?.missingProperty;
    if (missingProp) {
      return path ? `${path}.${missingProp}` : missingProp;
    }
  }

  return path || 'root';
}

/** AJV schema errors for authored map JSON (semantic checks are editor-time only). */
export function collectLevelSchemaErrors(raw: unknown): Array<{ field: string; error: string }> {
  const valid = validateSchema(raw);
  if (valid || !validateSchema.errors) return [];

  return validateSchema.errors.map((err) => ({
    field: schemaErrorField(err),
    error: err.message || 'Invalid value',
  }));
}

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
