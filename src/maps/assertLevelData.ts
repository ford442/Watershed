import type { LevelData } from '../systems/MapSystem';
import { validateLevel } from '../utils/levelValidator';
import { filterUnexpectedLevelErrors } from './levelSchemaDebt';

/**
 * Validate authored map JSON at registry load time.
 * Allows documented schema debt; rejects new drift outside that list.
 */
export function assertLevelData(raw: unknown, label: string): LevelData {
  const result = validateLevel(raw);
  const unexpected = filterUnexpectedLevelErrors(result.errors);
  if (unexpected.length > 0) {
    throw new Error(
      `[MAP_REGISTRY] ${label} failed level validation:\n${unexpected.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  return raw as LevelData;
}
