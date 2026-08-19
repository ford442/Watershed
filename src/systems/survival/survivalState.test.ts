import { describe, expect, it } from 'vitest';
import { getLoadoutDefinition } from './loadout';
import {
  createSurvivalState,
  getBiomeAmbientTemp,
  getSurvivalModifiers,
  tickSurvivalState,
} from './survivalState';

describe('survivalState transitions', () => {
  it('ramps wetness while in water and dries in sun', () => {
    const loadout = getLoadoutDefinition('balanced');
    let state = createSurvivalState();

    state = tickSurvivalState(
      state,
      {
        dt: 1,
        biomeId: 'canyonSummer',
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
        biomeId: 'canyonSummer',
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
          biomeId: 'glacier',
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
          biomeId: 'glacier',
          inWater: false,
          windSpeed: 4,
          launchHour: 6,
        },
        expedition,
      );
    }

    expect(lightState.coreTemp).toBeLessThan(expeditionState.coreTemp);
    expect(getBiomeAmbientTemp('glacier')).toBeLessThan(getBiomeAmbientTemp('canyonSummer'));
  });

  it('applies cold biome stamina penalties and wetness regen loss', () => {
    const loadout = getLoadoutDefinition('balanced');
    const dry = getSurvivalModifiers(
      { wetness: 0, coreTemp: 0.9 },
      'canyonSummer',
      loadout,
    );
    const coldWet = getSurvivalModifiers(
      { wetness: 0.8, coreTemp: 0.35 },
      'glacier',
      loadout,
    );

    expect(coldWet.staminaDrainMultiplier).toBeGreaterThan(dry.staminaDrainMultiplier);
    expect(coldWet.staminaRegenMultiplier).toBeLessThan(dry.staminaRegenMultiplier);
    expect(coldWet.exposureStress).toBeGreaterThan(0.2);
    expect(coldWet.sfxWetnessMultiplier).toBeLessThan(1);
  });
});
