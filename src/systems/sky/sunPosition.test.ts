import { describe, expect, it } from 'vitest';
import { daylightFraction, daylightSpan, solarDeclination, sunPosition } from './sunPosition';

const DEG = 180 / Math.PI;

describe('solarDeclination', () => {
  it('peaks near +23.4° at the June solstice and −23.4° in December, ~0 at the equinoxes', () => {
    expect(solarDeclination(172) * DEG).toBeCloseTo(23.4, 0);
    expect(solarDeclination(355) * DEG).toBeCloseTo(-23.4, 0);
    expect(Math.abs(solarDeclination(80) * DEG)).toBeLessThan(1);
    expect(Math.abs(solarDeclination(266) * DEG)).toBeLessThan(1);
  });
});

describe('sunPosition', () => {
  it('stands due south at solar noon in the northern hemisphere at 90 − φ + δ', () => {
    const sun = sunPosition(12, 46, 172);
    expect(sun.elevation * DEG).toBeCloseTo(90 - 46 + 23.4, 0);
    // South is +Z; east/west near zero at noon (the equation of time is minutes).
    expect(sun.z).toBeGreaterThan(0);
    expect(Math.abs(sun.x)).toBeLessThan(0.05);
    expect(sun.azimuth * DEG).toBeCloseTo(180, -1);
  });

  it('rises in the east and sets in the west, and is a unit vector', () => {
    const morning = sunPosition(7, 46, 244);
    const evening = sunPosition(17, 46, 244);
    expect(morning.x).toBeGreaterThan(0.5);
    expect(evening.x).toBeLessThan(-0.5);
    expect(morning.hourAngle).toBeLessThan(0);
    expect(evening.hourAngle).toBeGreaterThan(0);
    for (const s of [morning, evening]) expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6);
  });

  it('is below the horizon at midnight and symmetric about solar noon', () => {
    expect(sunPosition(0, 46, 244).elevation).toBeLessThan(0);
    const a = sunPosition(9, 46, 244);
    const b = sunPosition(15, 46, 244);
    // Within the equation of time (~0 at day 244) of mirror images.
    expect(a.elevation * DEG).toBeCloseTo(b.elevation * DEG, 0);
    expect(a.x).toBeCloseTo(-b.x, 1);
  });

  it('06:00 and 14:00 put the sun in different places', () => {
    const dawn = sunPosition(6, 46.5, 244);
    const afternoon = sunPosition(14, 46.5, 244);
    expect(dawn.elevation * DEG).toBeLessThan(10);
    expect(afternoon.elevation * DEG).toBeGreaterThan(35);
    expect(dawn.x).toBeGreaterThan(0);
    expect(afternoon.x).toBeLessThan(0);
  });
});

describe('daylightSpan / daylightFraction', () => {
  it('a ~12 h day at the equinox, longer in summer, polar day and night at the extremes', () => {
    const equinox = daylightSpan(46, 80);
    expect(equinox.sunset - equinox.sunrise).toBeCloseTo(12.1, 0);
    const summer = daylightSpan(46, 172);
    expect(summer.sunset - summer.sunrise).toBeGreaterThan(15);
    expect(daylightSpan(80, 172)).toEqual({ sunrise: 0, sunset: 24 });
    const polarNight = daylightSpan(80, 355);
    expect(polarNight.sunrise).toBe(polarNight.sunset);
  });

  it('is 0 at sunrise, ~0.5 at noon, 1 at sunset, outside [0, 1] at night', () => {
    const span = daylightSpan(46, 244);
    expect(daylightFraction(span.sunrise, span)).toBeCloseTo(0, 6);
    expect(daylightFraction(span.sunset, span)).toBeCloseTo(1, 6);
    expect(daylightFraction(12, span)).toBeCloseTo(0.5, 1);
    expect(daylightFraction(2, span)).toBeLessThan(0);
    expect(daylightFraction(22, span)).toBeGreaterThan(1);
    expect(daylightFraction(23.9, span)).toBeLessThanOrEqual(1.5);
  });
});
