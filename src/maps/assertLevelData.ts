import type { LevelData } from '../systems/MapSystem';
import { collectLevelSchemaErrors, filterUnexpectedLevelErrors } from './levelSchemaDebt';

/**
 * Validate authored map JSON at registry load time against `level.schema.json`.
 * Semantic editor checks (segment counts, waypoint spacing) stay in `validateLevel`.
 */
export function assertLevelData(raw: unknown, label: string): LevelData {
  const unexpected = filterUnexpectedLevelErrors(collectLevelSchemaErrors(raw));
  if (unexpected.length > 0) {
    throw new Error(
      `[MAP_REGISTRY] ${label} failed level validation:\n${unexpected.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  return raw as LevelData;
}
