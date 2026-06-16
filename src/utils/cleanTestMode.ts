/**
 * Clean test / screenshot mode — hides dev overlays and debug visuals.
 *
 * Enabled via ?cleanTest=1 (aliases: clean-test, cleantest) or automatically
 * when ?screenshot=1 / ?capture=1 is present.
 */

const CLEAN_TEST_KEYS = ['cleanTest', 'clean-test', 'cleantest'] as const;
const AUTO_CLEAN_KEYS = ['screenshot', 'capture'] as const;

export function isCleanTestMode(search?: string): boolean {
  if (typeof window === 'undefined' && search === undefined) return false;
  const params = new URLSearchParams(search ?? window.location.search);
  if (AUTO_CLEAN_KEYS.some((key) => params.get(key) === '1')) return true;
  return CLEAN_TEST_KEYS.some((key) => {
    const raw = params.get(key);
    return raw === '1' || raw === 'true';
  });
}

export function setCleanTestMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (enabled) {
    params.set('cleanTest', '1');
    CLEAN_TEST_KEYS.forEach((key) => {
      if (key !== 'cleanTest') params.delete(key);
    });
  } else {
    CLEAN_TEST_KEYS.forEach((key) => params.delete(key));
  }
  const next = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
}
