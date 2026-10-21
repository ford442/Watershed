import { describe, expect, it } from 'vitest';
import { getMapDefinition } from '../../maps/registry';
import { listMapsForMenu } from '../../maps/campaign';
import { runConditionsFairnessKey } from '../journey/runSession';
import { DAILY_LAUNCH_HOURS, dailyDateKey, dailyRiverFor, dailySeed } from './dailyRiver';

describe('dailyDateKey', () => {
  it('is the UTC date, so every timezone shares one day', () => {
    expect(dailyDateKey(Date.UTC(2026, 9, 21, 0, 0, 0))).toBe('2026-10-21');
    expect(dailyDateKey(Date.UTC(2026, 9, 21, 23, 59, 59))).toBe('2026-10-21');
    expect(dailyDateKey(Date.UTC(2026, 9, 22, 0, 0, 0))).toBe('2026-10-22');
  });
});

describe('dailyRiverFor', () => {
  it('is the same river for two clients on the same UTC date', () => {
    const a = dailyRiverFor('2026-10-21');
    const b = dailyRiverFor('2026-10-21');
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.seed).toBe(dailySeed('2026-10-21'));
  });

  it('changes from day to day', () => {
    const days = Array.from({ length: 60 }, (_, i) => dailyDateKey(Date.UTC(2026, 0, 1 + i)));
    const rivers = days.map((d) => dailyRiverFor(d));
    expect(new Set(rivers.map((r) => r.seed)).size).toBe(60);
    expect(new Set(rivers.map((r) => r.mapId)).size).toBeGreaterThan(2);
    expect(new Set(rivers.map((r) => r.launchHour)).size).toBeGreaterThan(5);
    expect(new Set(rivers.map((r) => r.pattern)).size).toBeGreaterThan(3);
    expect(new Set(rivers.map((r) => runConditionsFairnessKey(r.conditions))).size).toBe(60);
  });

  it('only builds playable rivers: a menu map, a daylight hour, sane melt, a valid script', () => {
    const menuMaps = new Set(listMapsForMenu().map((m) => m.id));
    for (let i = 0; i < 365; i += 1) {
      const river = dailyRiverFor(dailyDateKey(Date.UTC(2026, 0, 1 + i)));
      expect(menuMaps.has(river.mapId)).toBe(true);
      expect(river.launchHour).toBeGreaterThanOrEqual(DAILY_LAUNCH_HOURS.min);
      expect(river.launchHour).toBeLessThanOrEqual(DAILY_LAUNCH_HOURS.max);
      expect(river.conditions.temperature).toBeGreaterThanOrEqual(0);
      expect(river.conditions.temperature).toBeLessThanOrEqual(16);
      expect(river.conditions.snowpackIndex).toBeGreaterThanOrEqual(0.3);
      expect(river.conditions.snowpackIndex).toBeLessThanOrEqual(0.95);
      expect(river.conditions.dailyKey).toBe(river.dateKey);
      const script = river.conditions.weatherScript;
      expect(script[0].atReachFraction).toBe(0);
      for (let s = 1; s < script.length; s += 1) {
        expect(script[s].atReachFraction).toBeGreaterThanOrEqual(script[s - 1].atReachFraction);
      }
      const map = getMapDefinition(river.mapId);
      for (const step of script) {
        if (step.overSegment === undefined) continue;
        expect(step.overSegment).toBeGreaterThanOrEqual(map.startIndex);
      }
    }
  });

  it('a squall day sits its storm over one reach of the map', () => {
    let squall = null;
    for (let i = 0; i < 365 && !squall; i += 1) {
      const river = dailyRiverFor(dailyDateKey(Date.UTC(2026, 0, 1 + i)));
      if (river.pattern === 'squall') squall = river;
    }
    expect(squall).not.toBeNull();
    const storm = squall!.conditions.weatherScript.find((s) => s.weather === 'storm');
    expect(storm?.overSegment).toBeTypeOf('number');
    expect(storm?.rampSeconds).toBeGreaterThan(0);
    expect(squall!.conditions.weatherScript.at(-1)?.weather).toBe('clear');
  });
});
