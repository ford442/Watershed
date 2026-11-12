import { getI18nVersion, getLocale, resetI18nForTests, setLocale, subscribeLocale, t } from './i18n';

afterEach(() => resetI18nForTests());

describe('t()', () => {
  it('reads English synchronously before any locale has loaded', () => {
    expect(getLocale()).toBe('en');
    expect(t('locale.en')).toBe('English');
  });

  it('interpolates placeholders and formats number params for the locale', () => {
    expect(t('format.launchHour', { hour: '06' })).toBe('H06:00');
    expect(t('format.approx', { value: 1234 })).toBe('~1,234');
  });

  it('switches to a lazy locale, re-formats numbers, and falls back to English for a missing key', async () => {
    const seen: number[] = [];
    const off = subscribeLocale(() => seen.push(getI18nVersion()));
    await setLocale('fr');
    off();
    expect(getLocale()).toBe('fr');
    expect(seen).toHaveLength(1);
    expect(document.documentElement.lang).toBe('fr');
    expect(t('locale.en')).toBe('English'); // a language's own name is the same everywhere
    // fr groups thousands with a narrow no-break space.
    expect(t('format.approx', { value: 1234 })).toBe('~1\u202f234');
  });

  it('a later setLocale wins over an earlier one still loading', async () => {
    const slow = setLocale('es');
    const fast = setLocale('en');
    await Promise.all([slow, fast]);
    expect(getLocale()).toBe('en');
  });
});

describe('t() param typing', () => {
  it('a message with placeholders requires its params; one without takes none', () => {
    // @ts-expect-error — 'format.approx' needs { value }
    expect(t('format.approx')).toBe('~{value}');
    // @ts-expect-error — the param is named value, not v
    t('format.approx', { v: 1 });
    // @ts-expect-error — 'locale.en' takes no params
    t('locale.en', { x: 1 });
    // @ts-expect-error — not a key
    t('no.such.key');
    expect(t('locale.en')).toBe('English');
  });
});
