/**
 * Locale-aware formatting on `Intl` (#566). Formatters are cached per
 * locale + options; the cache is dropped on a locale change.
 */

import { getLocale, subscribeLocale, t } from './i18n';

const cache = new Map<string, Intl.NumberFormat | Intl.ListFormat>();
subscribeLocale(() => cache.clear());

function cached<T extends Intl.NumberFormat | Intl.ListFormat>(
  kind: string,
  options: object,
  make: (locale: string) => T,
): T {
  const id = `${kind}|${JSON.stringify(options)}`;
  let formatter = cache.get(id) as T | undefined;
  if (!formatter) {
    formatter = make(getLocale());
    cache.set(id, formatter);
  }
  return formatter;
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return cached('n', options, (l) => new Intl.NumberFormat(l, options)).format(value);
}

/** 0–1 → "42 %" / "42%" as the locale writes it. */
export function formatPercent(fraction: number): string {
  return formatNumber(fraction, { style: 'percent', maximumFractionDigits: 0 });
}

/** A fixed number of decimals with the locale's separator ("0.75" / "0,75"). */
export function formatFixed(value: number, digits: number): string {
  return formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** An estimate in whole minutes, at least one: "~4 min" (the start menu's map length). */
export function formatMinutes(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  const value = formatNumber(mins, { style: 'unit', unit: 'minute', unitDisplay: 'short' });
  return t('format.approx', { value });
}

/** Whole metres per second with the unit: "12 m/s". */
export function formatSpeed(mps: number): string {
  return formatNumber(Math.round(mps), { style: 'unit', unit: 'meter-per-second', unitDisplay: 'short' });
}

/** Kilometres, two decimals, with the unit: "1.25 km". */
export function formatKm(km: number): string {
  return formatNumber(km, {
    style: 'unit',
    unit: 'kilometer',
    unitDisplay: 'short',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The one split / delta formatter (#566): the shipped ghost-delta form, `±m:ss.cc`
 * with U+2212 for minus and `±ss.cc` under a minute. Rounded to centiseconds
 * before splitting (59.999… never reads 60.00); the decimal separator is the locale's.
 * `signed: false` drops the sign (a plain split).
 */
export function formatSplit(seconds: number, { signed = true }: { signed?: boolean } = {}): string {
  if (!Number.isFinite(seconds)) return '—';
  const sign = signed ? (seconds >= 0 ? '+' : '\u2212') : seconds < 0 ? '\u2212' : '';
  const abs = Math.abs(Math.round(seconds * 100) / 100);
  const mins = Math.floor(abs / 60);
  const secs = formatNumber(Math.min(abs % 60, 59.99), {
    minimumIntegerDigits: 2,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
  return mins > 0 ? `${sign}${mins}:${secs}` : `${sign}${secs}`;
}

/** An hour of the day as the HUD shows it everywhere: "H06:00". */
export function formatLaunchHour(hour: number): string {
  return t('format.launchHour', { hour: String(hour).padStart(2, '0') });
}

/** "a, b and c" in the locale's conjunction. */
export function formatList(items: readonly string[]): string {
  return cached('l', {}, (l) => new Intl.ListFormat(l, { style: 'long', type: 'conjunction' })).format(items);
}
