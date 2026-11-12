/**
 * workshopTemplates.ts — what a new river starts from (River Workshop E.1,
 * first cut): a blank template, or a copy of any campaign map.
 */
import { MAP_REGISTRY, type MapRegistryId } from '../maps/registry';
import { listMapsForMenu } from '../maps/campaign';
import type { LevelData } from '../systems/map/MapSystem.types';

export interface StartFromEntry {
  id: MapRegistryId;
  label: string;
}

/** The campaign maps a river can start from, in menu order. */
export function listStartFromMaps(): StartFromEntry[] {
  return listMapsForMenu().map((m) => ({ id: m.id, label: m.label }));
}

/** A deep copy of a campaign map's level, renamed so a save never shadows it. */
export function levelFromCampaignMap(id: MapRegistryId): LevelData {
  const level = structuredClone(MAP_REGISTRY[id].levelData);
  return {
    ...level,
    metadata: { ...level.metadata, name: `${level.metadata?.name || MAP_REGISTRY[id].label} (copy)` },
  };
}

/** Five gentle segments on a four-point spline: the smallest valid river. */
export function createBlankRiver(): LevelData {
  return {
    metadata: {
      name: 'Untitled River',
      author: 'Anonymous',
      difficulty: 'beginner',
      estimatedDuration: 120,
      version: '1.0.0',
    },
    world: {
      track: {
        waypoints: [
          [0, 0, 0],
          [0, -5, -50],
          [10, -10, -100],
          [-5, -15, -150],
        ],
        segmentLength: 30,
        totalSegments: 5,
        width: 35,
      },
      biome: {
        baseType: 'canyonSummer',
        sky: { color: '#87CEEB', cloudDensity: 0.4 },
        fog: { color: '#D4E9F7', near: 50, far: 200 },
        lighting: { sunIntensity: 1.4, sunAngle: 45 },
        water: { tint: '#1a6b8a', flowSpeed: 1.0 },
      },
    },
    segments: Array.from({ length: 5 }, (_, i) => ({
      index: i,
      name: `Segment ${i + 1}`,
      type: 'normal' as const,
      difficulty: 0.3,
      meanderStrength: 1.2,
      verticalBias: -0.5,
      forwardMomentum: 1.0,
      decorations: { trees: 10, grass: 20, rocks: 5 },
    })),
    spawns: {
      start: { position: [0, -4, 10], rotation: [0, 180, 0] },
      checkpoints: [],
    },
  };
}
