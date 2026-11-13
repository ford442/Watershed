/**
 * BindingRow — one action's key/mouse + gamepad capture row (#559 C, from
 * `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { ACTION_LABELS, type Binding, type SettingsAction } from '../../systems/settings/settingsDerive';
import { bindingLabel } from './bindingLabel';

/** Per-action key/mouse + gamepad capture row. */
export const BindingRow: React.FC<{
  action: SettingsAction;
  binding: Binding;
  padBinding: Binding;
  capturing: boolean;
  capturingPad: boolean;
  invalidMsg: string | null;
  onBeginCapture: () => void;
  onBeginPadCapture: () => void;
  onUnbind: () => void;
  onUnbindPad: () => void;
}> = ({
  action,
  binding,
  padBinding,
  capturing,
  capturingPad,
  invalidMsg,
  onBeginCapture,
  onBeginPadCapture,
  onUnbind,
  onUnbindPad,
}) => {
  const t = useT();
  const actionLabel = t(ACTION_LABELS[action]);
  const keyLabel = bindingLabel(binding, t);
  const padLabel = bindingLabel(padBinding, t);
  return (
  <div className="settings-panel-binding-row">
    <span className="settings-panel-binding-label">{actionLabel}</span>
    <div className="settings-panel-binding-controls">
      <button
        type="button"
        className={`settings-panel-binding-btn ${capturing ? 'capturing' : ''}`}
        onClick={onBeginCapture}
        aria-label={t('settings.bind.rebind', { action: actionLabel, binding: keyLabel })}
      >
        {capturing ? t('settings.bind.capturingKey') : keyLabel}
      </button>
      <button
        type="button"
        className="settings-panel-unbind-btn"
        onClick={onUnbind}
        aria-label={t('settings.bind.reset', { action: actionLabel })}
      >
        ↺
      </button>
      <button
        type="button"
        className={`settings-panel-binding-btn settings-panel-binding-btn--pad ${capturingPad ? 'capturing' : ''}`}
        onClick={onBeginPadCapture}
        aria-label={t('settings.bind.padRebind', { action: actionLabel, binding: padLabel })}
      >
        {capturingPad ? (
          t('settings.bind.capturingPad')
        ) : (
          <>
            {/* The pad glyph is decoration: the accessible name holds the binding (WCAG 2.5.3). */}
            <span aria-hidden="true">{t('settings.bind.padGlyph')}</span> {padLabel}
          </>
        )}
      </button>
      <button
        type="button"
        className="settings-panel-unbind-btn"
        onClick={onUnbindPad}
        aria-label={t('settings.bind.padReset', { action: actionLabel })}
      >
        ↺
      </button>
    </div>
    {invalidMsg && (
      <span className="settings-panel-binding-error" role="alert">
        {invalidMsg}
      </span>
    )}
  </div>
  );
};
