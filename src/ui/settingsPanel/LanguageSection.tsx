/**
 * Options → General → Language: the locale picker (#559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import type { MessageKey } from '../../i18n/i18n';
import type { LocalePref } from '../../i18n/types';

const LOCALE_OPTIONS = [
  ['system', 'locale.system'],
  ['en', 'locale.en'],
  ['es', 'locale.es'],
  ['fr', 'locale.fr'],
] as const satisfies readonly (readonly [LocalePref, MessageKey])[];

export const LanguageSection: React.FC = () => {
  const t = useT();
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);

  return (
    <section className="settings-panel-section" aria-label={t('settings.language.section')}>
      <h3 className="settings-panel-section-title">{t('settings.language.section')}</h3>
      <div className="settings-panel-row">
        <span className="settings-panel-label" id="settings-language-label">
          {t('settings.language.label')}
        </span>
        <div
          className="settings-panel-quality-buttons"
          role="radiogroup"
          aria-labelledby="settings-language-label"
        >
          {LOCALE_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              lang={value === 'system' ? undefined : value}
              className={`settings-panel-quality-btn ${locale === value ? 'active' : ''}`}
              onClick={() => setLocale(value)}
              aria-checked={locale === value}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <p className="settings-panel-note">{t('settings.language.note')}</p>
    </section>
  );
};
