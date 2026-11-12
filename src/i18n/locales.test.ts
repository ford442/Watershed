/**
 * Locale parity (#566). tsc already holds each catalog to the English keys and
 * plural shape (`satisfies LocaleCatalog`); this checks what types cannot: the
 * same `{placeholders}` both ways, no empty message, and the key set at runtime.
 * A contributor adding a locale adds one module and this test says what is missing.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { en } from './en';
import { common } from './en/common';
import { hud } from './en/hud';
import { menu } from './en/menu';
import { settings } from './en/settings';
import { pauseMenu } from './en/lazy/pauseMenu';
import { runResults } from './en/lazy/runResults';
import { settingsPanel } from './en/lazy/settingsPanel';
import { todaysRiver } from './en/lazy/todaysRiver';
import { touchControls } from './en/lazy/touchControls';
import { userRivers } from './en/lazy/userRivers';

/** Every English part, boot and lazy. */
const allParts = { common, hud, menu, settings, pauseMenu, runResults, settingsPanel, todaysRiver, touchControls, userRivers };
import { es } from './locales/es';
import { fr } from './locales/fr';
import { LOCALES } from './types';
import type { Message } from './types';

const dir = join(__dirname, 'locales');
/** Boot and lazy English together: what every other locale must hold. */
const english: Record<string, Message> = Object.assign({}, ...Object.values(allParts));
const placeholders = (m: Message): string[] => {
  const texts = typeof m === 'string' ? [m] : Object.values(m);
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort();
};

describe('locale catalogs', () => {
  it('ships one module per non-English locale and nothing else', () => {
    const files = readdirSync(dir).filter((f) => /^[a-z]{2}\.ts$/.test(f)).map((f) => f.replace('.ts', '')).sort();
    expect(files).toEqual(LOCALES.filter((l) => l !== 'en').sort());
  });

  it('English keys are unique across catalog parts', () => {
    const seen = new Map<string, string>();
    for (const [name, part] of Object.entries(allParts)) {
      for (const key of Object.keys(part)) {
        expect(seen.get(key), `${key} is in both ${seen.get(key)} and ${name}`).toBeUndefined();
        seen.set(key, name);
      }
    }
    for (const key of Object.keys(en)) expect(seen.has(key), key).toBe(true);
  });

  const catalogs: Record<string, Record<string, Message>> = { es, fr };
  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    describe(locale, () => {
      const catalog = catalogs[locale];

      it('has no missing and no extra key', () => {
        const enKeys = Object.keys(english).sort();
        const keys = Object.keys(catalog).sort();
        expect(enKeys.filter((k) => !(k in catalog)), 'missing').toEqual([]);
        expect(keys.filter((k) => !(k in english)), 'extra').toEqual([]);
      });

      it('keeps every placeholder and the plural shape', () => {
        for (const [key, source] of Object.entries(english) as [string, Message][]) {
          const message = catalog[key];
          if (message === undefined) continue;
          expect(placeholders(message), key).toEqual(placeholders(source));
          expect(typeof message, key).toBe(typeof source);
          if (typeof message === 'object') expect(typeof message.other, `${key}.other`).toBe('string');
        }
      });

      it('has no empty message', () => {
        for (const [key, message] of Object.entries(catalog)) {
          const texts = typeof message === 'string' ? [message] : Object.values(message);
          for (const text of texts) expect(text.trim(), key).not.toBe('');
        }
      });
    });
  }
});
