/**
 * Options → Comfort & Devices → Gamepad: dead zone, response curve,
 * vibration (#559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import { formatFixed } from '../../i18n/format';
import { percent, SliderRow, ToggleRow } from './rows';

export const GamepadSection: React.FC = () => {
  const t = useT();
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const hapticsStrength = useSettingsStore((s) => s.hapticsStrength);
  const gamepadDeadzone = useSettingsStore((s) => s.gamepadDeadzone);
  const gamepadCurve = useSettingsStore((s) => s.gamepadCurve);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);
  const setHapticsStrength = useSettingsStore((s) => s.setHapticsStrength);
  const setGamepadDeadzone = useSettingsStore((s) => s.setGamepadDeadzone);
  const setGamepadCurve = useSettingsStore((s) => s.setGamepadCurve);

  return (
    <section className="settings-panel-section" aria-label={t('settings.pad.section')}>
      <h3 className="settings-panel-section-title">{t('settings.pad.section')}</h3>
      <SliderRow
        id="pad-deadzone"
        label={t('settings.pad.deadzone')}
        min={0}
        max={0.5}
        step={0.01}
        value={gamepadDeadzone}
        format={percent}
        onChange={setGamepadDeadzone}
      />
      <SliderRow
        id="pad-curve"
        label={t('settings.pad.curve')}
        min={1}
        max={3}
        step={0.1}
        value={gamepadCurve}
        format={(v) => (v <= 1.05 ? t('settings.pad.linear') : t('settings.times', { value: formatFixed(v, 1) }))}
        onChange={setGamepadCurve}
      />
      <ToggleRow id="pad-haptics" label={t('settings.pad.vibration')} value={hapticsEnabled} onChange={setHapticsEnabled} />
      <SliderRow
        id="pad-haptics-strength"
        label={t('settings.pad.vibrationStrength')}
        min={0}
        max={1}
        step={0.05}
        value={hapticsStrength}
        format={percent}
        onChange={setHapticsStrength}
      />
      <p className="settings-panel-note">{t('settings.pad.note')}</p>
    </section>
  );
};
