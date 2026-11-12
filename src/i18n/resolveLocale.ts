/**
 * Which locale a player gets (#566): the Options choice, or with `system` the
 * first of `navigator.languages` whose language we ship (`es-MX` → `es`), else English.
 */

import { LOCALES, type LocaleId, type LocalePref } from './types';

export function resolveLocale(pref: LocalePref, languages: readonly string[] | undefined): LocaleId {
  if (pref !== 'system') return pref;
  for (const tag of languages ?? []) {
    const primary = tag.toLowerCase().split('-')[0];
    const hit = LOCALES.find((id) => id === primary);
    if (hit) return hit;
  }
  return 'en';
}

/** The browser's language list, or none (SSR / tests without a navigator). */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
