/**
 * Options → General → Controls: mouse sensitivity, invert Y and the rebind
 * rows (#559 C, from `SettingsPanel.tsx`). The capture state is the panel's
 * (`useBindingCapture`), which also turns menu navigation off while a rebind
 * is listening.
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import { formatFixed } from '../../i18n/format';
import { SETTINGS_ACTIONS } from '../../systems/settings/settingsDerive';
import { BindingRow } from './BindingRow';
import type { BindingCapture } from './useBindingCapture';

export const ControlsSection: React.FC<{ capture: BindingCapture }> = ({ capture }) => {
  const t = useT();
  const mouseSensitivity = useSettingsStore((s) => s.mouseSensitivity);
  const invertY = useSettingsStore((s) => s.invertY);
  const bindings = useSettingsStore((s) => s.bindings);
  const padBindings = useSettingsStore((s) => s.padBindings);
  const setSensitivity = useSettingsStore((s) => s.setSensitivity);
  const setInvertY = useSettingsStore((s) => s.setInvertY);
  const unbindAction = useSettingsStore((s) => s.unbindAction);
  const unbindPadAction = useSettingsStore((s) => s.unbindPadAction);
  const { capturing, capturingPad, invalid, beginCapture, beginPadCapture } = capture;

  return (
    <section className="settings-panel-section" aria-label={t('settings.controls.section')}>
      <h3 className="settings-panel-section-title">{t('settings.controls.section')}</h3>

      <div className="settings-panel-row">
        <label className="settings-panel-label" htmlFor="sensitivity">
          {t('settings.controls.sensitivity')}
        </label>
        <input
          id="sensitivity"
          type="range"
          min={0.1}
          max={2.0}
          step={0.05}
          value={mouseSensitivity}
          onChange={(e) => setSensitivity(parseFloat(e.target.value))}
          className="settings-panel-slider"
        />
        <span className="settings-panel-value">{t('settings.times', { value: formatFixed(mouseSensitivity, 2) })}</span>
      </div>

      <div className="settings-panel-row">
        <label className="settings-panel-label" htmlFor="invert-y">
          {t('settings.controls.invertY')}
        </label>
        <button
          id="invert-y"
          type="button"
          className={`settings-panel-toggle ${invertY ? 'on' : ''}`}
          onClick={() => setInvertY(!invertY)}
          role="switch"
          aria-checked={invertY}
        >
          {invertY ? t('settings.on') : t('settings.off')}
        </button>
      </div>

      <div className="settings-panel-bindings">
        {SETTINGS_ACTIONS.map((action) => (
          <BindingRow
            key={action}
            action={action}
            binding={bindings[action]}
            padBinding={padBindings[action]}
            capturing={capturing === action}
            capturingPad={capturingPad === action}
            invalidMsg={invalid?.action === action ? invalid.msg : null}
            onBeginCapture={() => beginCapture(action)}
            onBeginPadCapture={() => beginPadCapture(action)}
            onUnbind={() => unbindAction(action)}
            onUnbindPad={() => unbindPadAction(action)}
          />
        ))}
      </div>
    </section>
  );
};
