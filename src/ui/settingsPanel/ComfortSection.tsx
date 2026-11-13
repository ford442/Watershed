/**
 * Options → Comfort & Devices → Comfort: FOV, sprint FOV kick, shake,
 * vignette, speed effects, reduced motion (#559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import type { MessageKey } from '../../i18n/i18n';
import { formatNumber } from '../../i18n/format';
import { FOV_MAX, FOV_MIN, resolveReducedMotion, type ReducedMotionPref } from '../../systems/settings/comfort';
import { getOsReducedMotion } from '../../systems/settings/comfortRuntime';
import { percent, SliderRow, ToggleRow } from './rows';

const REDUCED_MOTION_LABELS = [
  ['system', 'settings.system'],
  ['on', 'settings.on'],
  ['off', 'settings.off'],
] as const satisfies readonly (readonly [ReducedMotionPref, MessageKey])[];

export const ComfortSection: React.FC = () => {
  const t = useT();
  const fov = useSettingsStore((s) => s.fov);
  const fovKick = useSettingsStore((s) => s.fovKick);
  const cameraShake = useSettingsStore((s) => s.cameraShake);
  const speedEffects = useSettingsStore((s) => s.speedEffects);
  const vignetteStrength = useSettingsStore((s) => s.vignetteStrength);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const setFov = useSettingsStore((s) => s.setFov);
  const setFovKick = useSettingsStore((s) => s.setFovKick);
  const setCameraShake = useSettingsStore((s) => s.setCameraShake);
  const setSpeedEffects = useSettingsStore((s) => s.setSpeedEffects);
  const setVignetteStrength = useSettingsStore((s) => s.setVignetteStrength);
  const setReducedMotion = useSettingsStore((s) => s.setReducedMotion);

  return (
    <section className="settings-panel-section" aria-label={t('settings.comfort.section')}>
      <h3 className="settings-panel-section-title">{t('settings.comfort.section')}</h3>
      <SliderRow
        id="comfort-fov"
        label={t('settings.comfort.fov')}
        min={FOV_MIN}
        max={FOV_MAX}
        step={1}
        value={fov}
        format={(v) => t('settings.degrees', { value: formatNumber(Math.round(v)) })}
        onChange={setFov}
      />
      <SliderRow
        id="comfort-fov-kick"
        label={t('settings.comfort.fovKick')}
        min={0}
        max={1}
        step={0.05}
        value={fovKick}
        format={percent}
        onChange={setFovKick}
      />
      <SliderRow
        id="comfort-shake"
        label={t('settings.comfort.shake')}
        min={0}
        max={1}
        step={0.05}
        value={cameraShake}
        format={percent}
        onChange={setCameraShake}
      />
      <SliderRow
        id="comfort-vignette"
        label={t('settings.comfort.vignette')}
        min={0}
        max={1}
        step={0.05}
        value={vignetteStrength}
        format={percent}
        onChange={setVignetteStrength}
      />
      <ToggleRow
        id="comfort-speed-effects"
        label={t('settings.comfort.speedEffects')}
        value={speedEffects}
        onChange={setSpeedEffects}
      />
      <div className="settings-panel-row">
        <label className="settings-panel-label">{t('settings.comfort.reducedMotion')}</label>
        <div className="settings-panel-quality-buttons">
          {REDUCED_MOTION_LABELS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`settings-panel-quality-btn ${reducedMotion === value ? 'active' : ''}`}
              onClick={() => setReducedMotion(value)}
              aria-pressed={reducedMotion === value}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <p className="settings-panel-note">
        {t('settings.comfort.reducedNote')}{' '}
        {resolveReducedMotion(reducedMotion, getOsReducedMotion())
          ? t('settings.comfort.systemNoteActive')
          : t('settings.comfort.systemNote')}
      </p>
    </section>
  );
};
