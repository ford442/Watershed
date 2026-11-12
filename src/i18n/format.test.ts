import { resetI18nForTests, setLocale } from './i18n';
import { formatKm, formatLaunchHour, formatMinutes, formatSpeed, formatSplit } from './format';

afterEach(() => resetI18nForTests());

describe('i18n formatters', () => {
  it('formatMinutes rounds to whole minutes, at least one', () => {
    expect(formatMinutes(240)).toBe('~4 min');
    expect(formatMinutes(10)).toBe('~1 min');
  });

  it('formatSplit is the shipped ghost-delta form: ±m:ss.cc, U+2212, ±ss.cc under a minute', () => {
    expect(formatSplit(83.456)).toBe('+1:23.46');
    expect(formatSplit(-5.2)).toBe('\u221205.20');
    expect(formatSplit(0)).toBe('+00.00');
    expect(formatSplit(59.999)).toBe('+1:00.00'); // rounded before splitting, never 0:60.00
    expect(formatSplit(119.996)).toBe('+2:00.00');
    expect(formatSplit(65.5, { signed: false })).toBe('1:05.50');
    expect(formatSplit(Number.NaN)).toBe('—');
  });

  it('formatSplit, formatSpeed and formatKm use the locale separator', async () => {
    expect(formatSpeed(12.4)).toBe('12 m/s');
    expect(formatKm(1.254)).toBe('1.25 km');
    await setLocale('fr');
    expect(formatSplit(83.456)).toBe('+1:23,46');
    expect(formatKm(1.254)).toBe('1,25\u202fkm');
  });

  it('formatLaunchHour pads the hour', () => {
    expect(formatLaunchHour(6)).toBe('H06:00');
    expect(formatLaunchHour(14)).toBe('H14:00');
  });
});
