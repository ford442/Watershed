/**
 * Options → Comfort & Devices → Touch: the left-handed layout (#559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import { ToggleRow } from './rows';

export const TouchSection: React.FC = () => {
  const t = useT();
  const leftHanded = useSettingsStore((s) => s.leftHanded);
  const setLeftHanded = useSettingsStore((s) => s.setLeftHanded);

  return (
    <section className="settings-panel-section" aria-label={t('settings.touch.section')}>
      <h3 className="settings-panel-section-title">{t('settings.touch.section')}</h3>
      <ToggleRow id="touch-left-handed" label={t('settings.touch.leftHanded')} value={leftHanded} onChange={setLeftHanded} />
    </section>
  );
};
