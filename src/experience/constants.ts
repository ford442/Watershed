import { DEBUG_STAGES } from '../debug/debugStages';
import type { DebugStageController } from '../debug/debugStages';
import { MAP_REGISTRY } from '../maps/registry';
import type { BiomeLightingConfig } from './lightingConfig';

export const DAM_RELEASE_SCHEDULE = [
  { hour: 6, release: 0.08 },
  // Peak release pushes melt+release over WashedOut so Hydro-Dam catwalks
  // open a gap; hour-6 Flooded keeps the portage ledge.
  { hour: 14, release: 0.35 },
] as const satisfies ReadonlyArray<{ hour: number; release: number }>;

export const DEFAULT_MAPS = MAP_REGISTRY;

/** Base lighting configuration keyed by canonical BiomePalette id. */
export const BIOME_LIGHTING: Record<string, BiomeLightingConfig> = {
  canyonSummer: {
    ambientIntensity: 0.40,
    hemiSky: '#9ad0f0',
    hemiGround: '#3a3828',
    hemiIntensity: 0.85,
    dirColor: '#fff4e0',
    dirIntensity: 1.4,
    dirPosition: [12, 35, 18],
    fillColor: '#a0c4e8',
    fillIntensity: 0.22,
  },
  canyonAutumn: {
    ambientIntensity: 0.32,
    hemiSky: '#e8c070',
    hemiGround: '#382818',
    hemiIntensity: 0.65,
    dirColor: '#ffa040',
    dirIntensity: 1.1,
    dirPosition: [30, 22, 12],
    fillColor: '#ffc888',
    fillIntensity: 0.18,
  },
  lumberFlume: {
    ambientIntensity: 0.38,
    hemiSky: '#90c0a0',
    hemiGround: '#2a4030',
    hemiIntensity: 0.75,
    dirColor: '#ffe8c0',
    dirIntensity: 1.05,
    dirPosition: [8, 28, 14],
    fillColor: '#b0d080',
    fillIntensity: 0.28,
  },
  hydroDam: {
    ambientIntensity: 0.42,
    hemiSky: '#6a7a8a',
    hemiGround: '#3a3a3a',
    hemiIntensity: 0.7,
    dirColor: '#e0e8f0',
    dirIntensity: 0.95,
    dirPosition: [10, 32, 16],
    fillColor: '#5a6a7a',
    fillIntensity: 0.32,
  },
};

export const NOOP_DEBUG: DebugStageController = {
  debugEnabled: false,
  stageConfig: DEBUG_STAGES,
  enabledStages: Object.keys(DEBUG_STAGES).reduce(
    (acc, key) => ({ ...acc, [key]: true }),
    {} as DebugStageController['enabledStages'],
  ),
  stageRuntime: {} as DebugStageController['stageRuntime'],
  isStageEnabled: () => true,
  setStageEnabled: () => {},
  runStage: async (_stageId, stageFn) => stageFn(),
  setStageLoading: () => {},
  setStageSuccess: () => {},
  setStageFailure: () => {},
};
