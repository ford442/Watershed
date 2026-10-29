import { describe, expect, it } from 'vitest';
import { getLoadoutDefinition } from './loadout';
import {
  createSurvivalState,
  getSurvivalModifiers,
  tickSurvivalState,
} from './survivalState';
import { gameplayProfileForBiome } from '../gameplay/gameplayProfile';

describe('survivalState transitions', () => {
  it('ramps wetness while in water and dries in sun', () => {
    const loadout = getLoadoutDefinition('balanced');
    let state = createSurvivalState();

    state = tickSurvivalState(
      state,
      {
        dt: 1,
        climate: gameplayProfileForBiome('canyonSummer'),
        inWater: true,
        windSpeed: 0,
        launchHour: 12,
      },
      loadout,
    );
    expect(state.wetness).toBeGreaterThan(0.4);

    state = tickSurvivalState(
      state,
      {
        dt: 4,
        climate: gameplayProfileForBiome('canyonSummer'),
        inWater: false,
        windSpeed: 18,
        launchHour: 12,
      },
      loadout,
    );
    expect(state.wetness).toBeLessThan(0.35);
  });

  it('drops core temp in glacier biomes, mitigated by expedition kit', () => {
    const light = getLoadoutDefinition('trail-light');
    const expedition = getLoadoutDefinition('expedition');

    let lightState = createSurvivalState();
    let expeditionState = createSurvivalState();

    for (let i = 0; i < 20; i += 1) {
      lightState = tickSurvivalState(
        lightState,
        {
          dt: 0.5,
          climate: gameplayProfileForBiome('glacier'),
          inWater: false,
          windSpeed: 4,
          launchHour: 6,
        },
        light,
      );
      expeditionState = tickSurvivalState(
        expeditionState,
        {
          dt: 0.5,
          climate: gameplayProfileForBiome('glacier'),
          inWater: false,
          windSpeed: 4,
          launchHour: 6,
        },
        expedition,
      );
    }

    expect(lightState.coreTemp).toBeLessThan(expeditionState.coreTemp);
    expect(gameplayProfileForBiome('glacier').ambientTemp).toBeLessThan(gameplayProfileForBiome('canyonSummer').ambientTemp);
  });

  it('applies cold biome stamina penalties and wetness regen loss', () => {
    const loadout = getLoadoutDefinition('balanced');
    const dry = getSurvivalModifiers(
      { wetness: 0, coreTemp: 0.9 },
      gameplayProfileForBiome('canyonSummer'),
      loadout,
    );
    const coldWet = getSurvivalModifiers(
      { wetness: 0.8, coreTemp: 0.35 },
      gameplayProfileForBiome('glacier'),
      loadout,
    );

    expect(coldWet.staminaDrainMultiplier).toBeGreaterThan(dry.staminaDrainMultiplier);
    expect(coldWet.staminaRegenMultiplier).toBeLessThan(dry.staminaRegenMultiplier);
    expect(coldWet.exposureStress).toBeGreaterThan(0.2);
    expect(coldWet.sfxWetnessMultiplier).toBeLessThan(1);
  });
});
