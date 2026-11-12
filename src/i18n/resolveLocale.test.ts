import { resolveLocale } from './resolveLocale';

describe('resolveLocale', () => {
  it('an explicit choice wins over the browser', () => {
    expect(resolveLocale('fr', ['es-ES', 'en'])).toBe('fr');
  });

  it('system takes the first browser language we ship, by primary subtag', () => {
    expect(resolveLocale('system', ['de-DE', 'es-MX', 'fr'])).toBe('es');
    expect(resolveLocale('system', ['FR-ca'])).toBe('fr');
  });

  it('system with nothing we ship (or no list) is English', () => {
    expect(resolveLocale('system', ['de', 'ja'])).toBe('en');
    expect(resolveLocale('system', undefined)).toBe('en');
  });
});
