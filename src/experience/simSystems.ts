/**
 * simSystems — which systems SimCore steps, in one place (#521 A).
 *
 * The composition root for the registry: `<SimCoreTick />` registers this list
 * on mount. SimCore itself (sim/core) knows no system; each system's module
 * knows only itself. Order bands are documented in sim/core/SimCore.ts.
 */
import type { DebugStageController } from '../debug/debugStages';
import type { SimSystem } from '../sim/core/SimCore';
import { createChunkBiomeSimSystem } from '../systems/map/chunkBiomeSystem';
import { createSurvivalSimSystem } from '../systems/journey/survivalSystem';
import { createGameplayProfileSimSystem } from '../systems/map/gameplayProfile';
import { createWeatherSimSystem } from '../systems/weather/weatherSimSystem';
import { createSkySimSystem } from '../systems/sky/skySimSystem';
import { createPillarSimSystem } from '../components/Obstacles/pillarSimSystem';
import { createScoreSimSystem } from './scoreSimSystem';

export function createSimSystems(debug: DebugStageController): SimSystem[] {
  return [
    createWeatherSimSystem(),
    createSkySimSystem(),
    createChunkBiomeSimSystem(),
    createSurvivalSimSystem(),
    createPillarSimSystem(),
    createGameplayProfileSimSystem(),
    createScoreSimSystem(debug),
  ];
}
