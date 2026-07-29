/**
 * SettingsPanel.tsx — Player-facing settings overlay.
 *
 * Reachable from StartMenu ("Options") and PauseMenu. Reads and writes the
 * dedicated `useSettingsStore`. Panel and all setting application are gated on
 * `_hasHydrated` to avoid a flash-of-defaults.
 *
 * CAPTURE WIDGET: drei has no "listen for next input" helper, so we build one.
 * Capture runs in the UNLOCKED (normal DOM) state — the panel only mounts inside
 * the menu/pause overlays, where the pointer is never locked — so a rebind never
 * fights pointer-lock. A focused "Rebind" button records the next keydown OR
 * mousedown as a Binding; reserved inputs are refused; Escape cancels capture.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  useSettingsStore,
} from '../systems/useSettingsStore';
import {
  ACTION_LABELS,
  QUALITY_LABELS,
  SETTINGS_ACTIONS,
  isReservedKeyCapture,
  type Binding,
  type SettingsAction,
  type SettingsQuality,
  type VolumeChannel,
} from '../systems/settingsDerive';

interface SettingsPanelProps {
  /** Called when the player dismisses the panel (returns to the parent menu). */
  onClose: () => void;
}

const MOUSE_LABELS: Record<string, string> = {
  Mouse0: 'Left Click',
  Mouse1: 'Middle Click',
  Mouse2: 'Right Click',
};

function bindingLabel(binding: Binding): string {
  if (binding.kind === 'mouse') return MOUSE_LABELS[binding.code] ?? binding.code;
  // Friendly-ish label from event.code: 'KeyW' → 'W', 'ArrowUp' → 'Arrow Up'.
  if (binding.code.startsWith('Key')) return binding.code.slice(3);
  if (binding.code.startsWith('Digit')) return binding.code.slice(5);
  if (binding.code === 'Space') return 'Space';
  return binding.code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

const VOLUME_CHANNELS: { channel: VolumeChannel; label: string }[] = [
  { channel: 'master', label: 'Master' },
  { channel: 'music', label: 'Music' },
  { channel: 'sfx', label: 'SFX' },
];

/** Per-action key/mouse capture row. */
const BindingRow: React.FC<{
  action: SettingsAction;
  binding: Binding;
  capturing: boolean;
  invalidMsg: string | null;
  onBeginCapture: () => void;
  onUnbind: () => void;
}> = ({ action, binding, capturing, invalidMsg, onBeginCapture, onUnbind }) => (
  <div className="settings-panel-binding-row">
    <span className="settings-panel-binding-label">{ACTION_LABELS[action]}</span>
    <div className="settings-panel-binding-controls">
      <button
        type="button"
        className={`settings-panel-binding-btn ${capturing ? 'capturing' : ''}`}
        onClick={onBeginCapture}
        aria-label={`Rebind ${ACTION_LABELS[action]} (currently ${bindingLabel(binding)})`}
      >
        {capturing ? 'Press any key…' : bindingLabel(binding)}
      </button>
      <button
        type="button"
        className="settings-panel-unbind-btn"
        onClick={onUnbind}
        aria-label={`Reset ${ACTION_LABELS[action]} binding to default`}
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const masterVolume = useSettingsStore((s) => s.masterVolume);
  const musicVolume = useSettingsStore((s) => s.musicVolume);
  const sfxVolume = useSettingsStore((s) => s.sfxVolume);
  const mouseSensitivity = useSettingsStore((s) => s.mouseSensitivity);
  const invertY = useSettingsStore((s) => s.invertY);
  const quality = useSettingsStore((s) => s.quality);
  const bindings = useSettingsStore((s) => s.bindings);

  const setVolume = useSettingsStore((s) => s.setVolume);
  const setSensitivity = useSettingsStore((s) => s.setSensitivity);
  const setInvertY = useSettingsStore((s) => s.setInvertY);
  const setQuality = useSettingsStore((s) => s.setQuality);
  const bindAction = useSettingsStore((s) => s.bindAction);
  const unbindAction = useSettingsStore((s) => s.unbindAction);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  const [capturing, setCapturing] = useState<SettingsAction | null>(null);
  const [invalid, setInvalid] = useState<{ action: SettingsAction; msg: string } | null>(null);

  const volumeByChannel: Record<VolumeChannel, number> = {
    master: masterVolume,
    music: musicVolume,
    sfx: sfxVolume,
  };

  const beginCapture = useCallback((action: SettingsAction) => {
    setInvalid(null);
    setCapturing(action);
  }, []);

  // Listen for the next physical input while capturing.
  useEffect(() => {
    if (!capturing) return;
    const action = capturing;

    const finish = (binding: Binding) => {
      bindAction(action, binding);
      setCapturing(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setCapturing(null); // cancel
        return;
      }
      if (isReservedKeyCapture(e)) {
        setInvalid({ action, msg: 'That key is reserved.' });
        setCapturing(null);
        return;
      }
      finish({ kind: 'key', code: e.code });
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      finish({ kind: 'mouse', code: `Mouse${e.button}` });
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    // Capture phase so we intercept before other handlers.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [capturing, bindAction]);

  if (!hasHydrated) {
    return (
      <div className="settings-panel" role="dialog" aria-label="Settings" aria-busy="true">
        <p className="settings-panel-loading">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="settings-panel" role="dialog" aria-label="Settings">
      <h2 className="settings-panel-title">Options</h2>

      <section className="settings-panel-section" aria-label="Audio">
        <h3 className="settings-panel-section-title">Audio</h3>
        {VOLUME_CHANNELS.map(({ channel, label }) => (
          <div className="settings-panel-row" key={channel}>
            <label className="settings-panel-label" htmlFor={`vol-${channel}`}>
              {label} Volume
            </label>
            <input
              id={`vol-${channel}`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumeByChannel[channel]}
              onChange={(e) => setVolume(channel, parseFloat(e.target.value))}
              className="settings-panel-slider"
            />
            <span className="settings-panel-value">
              {Math.round(volumeByChannel[channel] * 100)}%
            </span>
          </div>
        ))}
      </section>

      <section className="settings-panel-section" aria-label="Controls">
        <h3 className="settings-panel-section-title">Controls</h3>

        <div className="settings-panel-row">
          <label className="settings-panel-label" htmlFor="sensitivity">
            Mouse Sensitivity
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
          <span className="settings-panel-value">{mouseSensitivity.toFixed(2)}×</span>
        </div>

        <div className="settings-panel-row">
          <label className="settings-panel-label" htmlFor="invert-y">
            Invert Y-Axis
          </label>
          <button
            id="invert-y"
            type="button"
            className={`settings-panel-toggle ${invertY ? 'on' : ''}`}
            onClick={() => setInvertY(!invertY)}
            role="switch"
            aria-checked={invertY}
          >
            {invertY ? 'On' : 'Off'}
          </button>
        </div>

        <div className="settings-panel-bindings">
          {SETTINGS_ACTIONS.map((action) => (
            <BindingRow
              key={action}
              action={action}
              binding={bindings[action]}
              capturing={capturing === action}
              invalidMsg={invalid?.action === action ? invalid.msg : null}
              onBeginCapture={() => beginCapture(action)}
              onUnbind={() => unbindAction(action)}
            />
          ))}
        </div>
      </section>

      <section className="settings-panel-section" aria-label="Graphics">
        <h3 className="settings-panel-section-title">Graphics</h3>
        <div className="settings-panel-row">
          <label className="settings-panel-label">Quality</label>
          <div className="settings-panel-quality-buttons">
            {(Object.keys(QUALITY_LABELS) as SettingsQuality[]).map((q) => (
              <button
                key={q}
                type="button"
                className={`settings-panel-quality-btn ${quality === q ? 'active' : ''}`}
                onClick={() => setQuality(q)}
                aria-pressed={quality === q}
              >
                {QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-panel-note">
          Effect toggles apply immediately. Resolution changes apply on next map load.
        </p>
      </section>

      <div className="settings-panel-footer">
        <button
          type="button"
          className="settings-panel-reset-btn"
          onClick={resetToDefaults}
        >
          Reset to Defaults
        </button>
        <button type="button" className="settings-panel-close-btn" onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;
