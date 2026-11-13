/**
 * Options → General → Graphics: the quality preset (#559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import { QUALITY_LABELS, type SettingsQuality } from '../../systems/settings/settingsDerive';

export const GraphicsSection: React.FC = () => {
  const t = useT();
  const quality = useSettingsStore((s) => s.quality);
  const setQuality = useSettingsStore((s) => s.setQuality);

  return (
    <section className="settings-panel-section" aria-label={t('settings.graphics.section')}>
      <h3 className="settings-panel-section-title">{t('settings.graphics.section')}</h3>
      <div className="settings-panel-row">
        <label className="settings-panel-label">{t('settings.graphics.quality')}</label>
        <div className="settings-panel-quality-buttons">
          {(Object.keys(QUALITY_LABELS) as SettingsQuality[]).map((q) => (
            <button
              key={q}
              type="button"
              className={`settings-panel-quality-btn ${quality === q ? 'active' : ''}`}
              onClick={() => setQuality(q)}
              aria-pressed={quality === q}
            >
              {t(QUALITY_LABELS[q])}
            </button>
          ))}
        </div>
      </div>
      <p className="settings-panel-note">{t('settings.graphics.note')}</p>
    </section>
  );
};
