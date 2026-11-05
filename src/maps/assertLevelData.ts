import type { LevelData } from '../systems/map/MapSystem';
import { validateLevel } from '../utils/levelValidator';
import { filterUnexpectedLevelErrors } from './levelSchemaDebt';

/**
 * Validate authored map JSON at registry load time.
 * Allows documented schema debt; rejects new drift outside that list.
 *
 * Returns the validator's own `data` (the same reference as `raw`: `validateLevel`
 * does not clone), so a pass needs no cast. A result the debt list excused but that
 * still did not validate has no `LevelData` to hand back, so it throws too.
 */
export function assertLevelData(raw: unknown, label: string): LevelData {
  const result = validateLevel(raw);
  const unexpected = filterUnexpectedLevelErrors(result.errors);
  if (unexpected.length > 0) {
    throw new Error(
      `[MAP_REGISTRY] ${label} failed level validation:\n${unexpected.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  if (!result.valid) {
    throw new Error(
      `[MAP_REGISTRY] ${label} failed level validation (only known schema debt reported, but the document did not validate)`,
    );
  }
  return result.data;
}
