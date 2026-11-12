/**
 * useT (#559 A.1) — the component side of `t()`: re-renders on a locale change.
 * The returned function is new per locale, so a memo that lists it re-runs.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { getI18nVersion, subscribeLocale, t, type TFunction } from './i18n';

export function useT(): TFunction {
  const version = useSyncExternalStore(subscribeLocale, getI18nVersion, getI18nVersion);
  return useMemo<TFunction>(() => {
    void version;
    return (key, ...args) => t(key, ...args);
  }, [version]);
}
