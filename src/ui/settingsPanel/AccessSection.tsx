/**
 * Options → Accessibility: UI scale, colour-vision palette, captions (#558;
 * #559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import type { MessageKey } from '../../i18n/i18n';
import { UI_SCALE_MAX, UI_SCALE_MIN, type ColorVisionMode } from '../../systems/settings/access';
import { ChoiceRow, percent, SliderRow, ToggleRow } from './rows';

const COLOR_VISION_LABELS = [
  ['off', 'settings.cvd.off'],
  ['deuteranopia', 'settings.cvd.deuteranopia'],
  ['protanopia', 'settings.cvd.protanopia'],
  ['tritanopia', 'settings.cvd.tritanopia'],
  ['highContrast', 'settings.cvd.highContrast'],
] as const satisfies readonly (readonly [ColorVisionMode, MessageKey])[];

export const AccessSection: React.FC = () => {
  const t = useT();
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setUiScale = useSettingsStore((s) => s.setUiScale);
  const colorVision = useSettingsStore((s) => s.colorVision);
  const setColorVision = useSettingsStore((s) => s.setColorVision);
  const captions = useSettingsStore((s) => s.captions);
  const setCaptions = useSettingsStore((s) => s.setCaptions);

  return (
    <section className="settings-panel-section" aria-label={t('settings.access.section')}>
      <h3 className="settings-panel-section-title">{t('settings.access.section')}</h3>
      <SliderRow
        id="access-ui-scale"
        label={t('settings.access.uiScale')}
        min={UI_SCALE_MIN}
        max={UI_SCALE_MAX}
        step={0.05}
        value={uiScale}
        format={percent}
        onChange={setUiScale}
      />
      <p className="settings-panel-note">{t('settings.access.uiScaleNote')}</p>
      <ChoiceRow
        id="access-cvd"
        label={t('settings.access.colorVision')}
        options={COLOR_VISION_LABELS}
        value={colorVision}
        onChange={setColorVision}
      />
      <p className="settings-panel-note">{t('settings.access.colorVisionNote')}</p>
      <ToggleRow id="access-captions" label={t('settings.access.captions')} value={captions} onChange={setCaptions} />
      <p className="settings-panel-note">{t('settings.access.captionsNote')}</p>
    </section>
  );
};
