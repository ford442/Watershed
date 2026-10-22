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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMenuFocus } from '../hooks/useMenuFocus';
import { detectPadCapture, type PadLike } from '../input/sources/gamepadMapping';
import { firstStandardPad } from '../input/menuNav';
import { FOV_MAX, FOV_MIN, resolveReducedMotion, type ReducedMotionPref } from '../systems/settings/comfort';
import { getOsReducedMotion } from '../systems/settings/comfortRuntime';
import {
  useSettingsStore,
} from '../systems/settings/useSettingsStore';
import {
  ACTION_LABELS,
  QUALITY_LABELS,
  SETTINGS_ACTIONS,
  isReservedKeyCapture,
  type Binding,
  type SettingsAction,
  type SettingsQuality,
  type VolumeChannel,
} from '../systems/settings/settingsDerive';
import type { PhysicsWorkerPreference } from '../utils/physicsWorkerFlag';

interface SettingsPanelProps {
  /** Called when the player dismisses the panel (returns to the parent menu). */
  onClose: () => void;
}

const MOUSE_LABELS: Record<string, string> = {
  Mouse0: 'Left Click',
  Mouse1: 'Middle Click',
  Mouse2: 'Right Click',
};

/** Standard-mapping names, so a pad binding reads "A" or "Left Stick ↑" rather than "Button0". */
const PAD_BUTTON_LABELS: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Back', 9: 'Start',
  10: 'L3', 11: 'R3', 12: 'D-pad ↑', 13: 'D-pad ↓', 14: 'D-pad ←', 15: 'D-pad →',
};
const PAD_AXIS_NAMES: Record<number, [string, string]> = {
  0: ['Left Stick ←', 'Left Stick →'],
  1: ['Left Stick ↑', 'Left Stick ↓'],
  2: ['Right Stick ←', 'Right Stick →'],
  3: ['Right Stick ↑', 'Right Stick ↓'],
};

function bindingLabel(binding: Binding): string {
  if (binding.kind === 'gamepad-button') {
    const n = Number(binding.code.slice(6));
    return PAD_BUTTON_LABELS[n] ?? `Button ${n}`;
  }
  if (binding.kind === 'gamepad-axis') {
    const n = Number(binding.code.slice(4, -1));
    const positive = binding.code.endsWith('+');
    const names = PAD_AXIS_NAMES[n];
    return names ? names[positive ? 1 : 0] : `Axis ${n}${positive ? '+' : '−'}`;
  }
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

/** Per-action key/mouse + gamepad capture row. */
const BindingRow: React.FC<{
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
}) => (
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
      <button
        type="button"
        className={`settings-panel-binding-btn settings-panel-binding-btn--pad ${capturingPad ? 'capturing' : ''}`}
        onClick={onBeginPadCapture}
        aria-label={`Gamepad button for ${ACTION_LABELS[action]} (currently ${bindingLabel(padBinding)})`}
      >
        {capturingPad ? 'Press a button…' : `🎮 ${bindingLabel(padBinding)}`}
      </button>
      <button
        type="button"
        className="settings-panel-unbind-btn"
        onClick={onUnbindPad}
        aria-label={`Restore default gamepad button for ${ACTION_LABELS[action]}`}
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

/** A labelled slider row, shared by the Comfort page. */
const SliderRow: React.FC<{
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}> = ({ id, label, min, max, step, value, format, onChange }) => (
  <div className="settings-panel-row">
    <label className="settings-panel-label" htmlFor={id}>
      {label}
    </label>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="settings-panel-slider"
    />
    <span className="settings-panel-value">{format(value)}</span>
  </div>
);

/** A labelled on/off switch row. */
const ToggleRow: React.FC<{ id: string; label: string; value: boolean; onChange: (v: boolean) => void }> = ({
  id,
  label,
  value,
  onChange,
}) => (
  <div className="settings-panel-row">
    <label className="settings-panel-label" htmlFor={id}>
      {label}
    </label>
    <button
      id={id}
      type="button"
      className={`settings-panel-toggle ${value ? 'on' : ''}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      {value ? 'On' : 'Off'}
    </button>
  </div>
);

const REDUCED_MOTION_LABELS: [ReducedMotionPref, string][] = [
  ['system', 'System'],
  ['on', 'On'],
  ['off', 'Off'],
];

type SettingsPage = 'general' | 'comfort';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const masterVolume = useSettingsStore((s) => s.masterVolume);
  const musicVolume = useSettingsStore((s) => s.musicVolume);
  const sfxVolume = useSettingsStore((s) => s.sfxVolume);
  const mouseSensitivity = useSettingsStore((s) => s.mouseSensitivity);
  const invertY = useSettingsStore((s) => s.invertY);
  const quality = useSettingsStore((s) => s.quality);
  const bindings = useSettingsStore((s) => s.bindings);
  const padBindings = useSettingsStore((s) => s.padBindings);

  const fov = useSettingsStore((s) => s.fov);
  const fovKick = useSettingsStore((s) => s.fovKick);
  const cameraShake = useSettingsStore((s) => s.cameraShake);
  const speedEffects = useSettingsStore((s) => s.speedEffects);
  const vignetteStrength = useSettingsStore((s) => s.vignetteStrength);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const leftHanded = useSettingsStore((s) => s.leftHanded);
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const hapticsStrength = useSettingsStore((s) => s.hapticsStrength);
  const gamepadDeadzone = useSettingsStore((s) => s.gamepadDeadzone);
  const gamepadCurve = useSettingsStore((s) => s.gamepadCurve);
  const setFov = useSettingsStore((s) => s.setFov);
  const setFovKick = useSettingsStore((s) => s.setFovKick);
  const setCameraShake = useSettingsStore((s) => s.setCameraShake);
  const setSpeedEffects = useSettingsStore((s) => s.setSpeedEffects);
  const setVignetteStrength = useSettingsStore((s) => s.setVignetteStrength);
  const setReducedMotion = useSettingsStore((s) => s.setReducedMotion);
  const setLeftHanded = useSettingsStore((s) => s.setLeftHanded);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);
  const setHapticsStrength = useSettingsStore((s) => s.setHapticsStrength);
  const setGamepadDeadzone = useSettingsStore((s) => s.setGamepadDeadzone);
  const setGamepadCurve = useSettingsStore((s) => s.setGamepadCurve);
  const unbindPadAction = useSettingsStore((s) => s.unbindPadAction);

  const setVolume = useSettingsStore((s) => s.setVolume);
  const setSensitivity = useSettingsStore((s) => s.setSensitivity);
  const setInvertY = useSettingsStore((s) => s.setInvertY);
  const setQuality = useSettingsStore((s) => s.setQuality);
  const physicsWorker = useSettingsStore((s) => s.physicsWorker);
  const setPhysicsWorker = useSettingsStore((s) => s.setPhysicsWorker);
  const bindAction = useSettingsStore((s) => s.bindAction);
  const unbindAction = useSettingsStore((s) => s.unbindAction);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  const [page, setPage] = useState<SettingsPage>('general');
  const [capturing, setCapturing] = useState<SettingsAction | null>(null);
  const [capturingPad, setCapturingPad] = useState<SettingsAction | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Arrow keys / d-pad walk the panel; B backs out. Off while a rebind is
  // listening, so the very input being captured is not also navigation.
  useMenuFocus(panelRef, { enabled: capturing === null && capturingPad === null, onBack: onClose });
  const [invalid, setInvalid] = useState<{ action: SettingsAction; msg: string } | null>(null);

  const volumeByChannel: Record<VolumeChannel, number> = {
    master: masterVolume,
    music: musicVolume,
    sfx: sfxVolume,
  };

  const beginCapture = useCallback((action: SettingsAction) => {
    setInvalid(null);
    setCapturingPad(null);
    setCapturing(action);
  }, []);

  const beginPadCapture = useCallback((action: SettingsAction) => {
    setInvalid(null);
    setCapturing(null);
    setCapturingPad(action);
  }, []);

  // Gamepad capture: poll for the next button / stick push. Waits for every
  // button to be released first (the A press that clicked "Rebind" must not be
  // captured as the binding), and measures stick rest so drift is ignored.
  useEffect(() => {
    if (!capturingPad) return undefined;
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      setCapturingPad(null);
      return undefined;
    }
    const action = capturingPad;
    let raf = 0;
    let armed = false;
    let rest: number[] | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setCapturingPad(null);
      }
    };
    const poll = () => {
      const pad: PadLike | null = firstStandardPad(navigator.getGamepads() as ArrayLike<PadLike | null>);
      if (pad) {
        if (!rest) rest = Array.from(pad.axes);
        if (!armed) {
          let anyDown = false;
          for (let i = 0; i < pad.buttons.length; i += 1) if (pad.buttons[i].pressed) anyDown = true;
          armed = !anyDown;
        } else {
          const hit = detectPadCapture(pad, rest);
          if (hit) {
            bindAction(action, hit);
            setCapturingPad(null);
            return;
          }
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [capturingPad, bindAction]);

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
      <div className="settings-panel" role="dialog" aria-label="Settings" aria-busy="true" ref={panelRef}>
        <p className="settings-panel-loading">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="settings-panel" role="dialog" aria-label="Settings" ref={panelRef}>
      <h2 className="settings-panel-title">Options</h2>

      <div className="settings-panel-tabs" role="tablist" aria-label="Options pages">
        {(
          [
            ['general', 'General'],
            ['comfort', 'Comfort & Devices'],
          ] as [SettingsPage, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            className={`settings-panel-tab ${page === id ? 'active' : ''}`}
            onClick={() => setPage(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {page === 'general' ? (
        <>

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
          Water surface displacement is off on Low.
        </p>
      </section>

      <section className="settings-panel-section" aria-label="Physics">
        <h3 className="settings-panel-section-title">Physics</h3>
        <div className="settings-panel-row">
          <label className="settings-panel-label">Physics worker</label>
          <div className="settings-panel-quality-buttons">
            {(
              [
                ['auto', 'Auto'],
                ['on', 'On'],
                ['off', 'Off'],
              ] as [PhysicsWorkerPreference, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`settings-panel-quality-btn ${physicsWorker === value ? 'active' : ''}`}
                onClick={() => setPhysicsWorker(value)}
                aria-pressed={physicsWorker === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-panel-note">
          Auto runs Rapier and the native water forces in a worker wherever the browser
          supports it. Turn it off if the raft feels wrong; applies on next map load.
        </p>
      </section>

        </>
      ) : (
        <>
          <section className="settings-panel-section" aria-label="Comfort">
            <h3 className="settings-panel-section-title">Comfort</h3>
            <SliderRow
              id="comfort-fov"
              label="Field of view"
              min={FOV_MIN}
              max={FOV_MAX}
              step={1}
              value={fov}
              format={(v) => `${Math.round(v)}°`}
              onChange={setFov}
            />
            <SliderRow
              id="comfort-fov-kick"
              label="Sprint FOV kick"
              min={0}
              max={1}
              step={0.05}
              value={fovKick}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={setFovKick}
            />
            <SliderRow
              id="comfort-shake"
              label="Camera shake"
              min={0}
              max={1}
              step={0.05}
              value={cameraShake}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={setCameraShake}
            />
            <SliderRow
              id="comfort-vignette"
              label="Vignette"
              min={0}
              max={1}
              step={0.05}
              value={vignetteStrength}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={setVignetteStrength}
            />
            <ToggleRow
              id="comfort-speed-effects"
              label="Speed blur / chromatic aberration"
              value={speedEffects}
              onChange={setSpeedEffects}
            />
            <div className="settings-panel-row">
              <label className="settings-panel-label">Reduced motion</label>
              <div className="settings-panel-quality-buttons">
                {REDUCED_MOTION_LABELS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`settings-panel-quality-btn ${reducedMotion === value ? 'active' : ''}`}
                    onClick={() => setReducedMotion(value)}
                    aria-pressed={reducedMotion === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="settings-panel-note">
              Reduced motion switches off camera shake, the sprint FOV kick and speed blur.
              {' '}System follows your device's setting
              {resolveReducedMotion(reducedMotion, getOsReducedMotion()) ? ' (currently reducing motion).' : '.'}
            </p>
          </section>

          <section className="settings-panel-section" aria-label="Touch">
            <h3 className="settings-panel-section-title">Touch</h3>
            <ToggleRow id="touch-left-handed" label="Left-handed layout" value={leftHanded} onChange={setLeftHanded} />
          </section>

          <section className="settings-panel-section" aria-label="Gamepad">
            <h3 className="settings-panel-section-title">Gamepad</h3>
            <SliderRow
              id="pad-deadzone"
              label="Stick dead zone"
              min={0}
              max={0.5}
              step={0.01}
              value={gamepadDeadzone}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={setGamepadDeadzone}
            />
            <SliderRow
              id="pad-curve"
              label="Response curve"
              min={1}
              max={3}
              step={0.1}
              value={gamepadCurve}
              format={(v) => (v <= 1.05 ? 'Linear' : `${v.toFixed(1)}×`)}
              onChange={setGamepadCurve}
            />
            <ToggleRow id="pad-haptics" label="Vibration" value={hapticsEnabled} onChange={setHapticsEnabled} />
            <SliderRow
              id="pad-haptics-strength"
              label="Vibration strength"
              min={0}
              max={1}
              step={0.05}
              value={hapticsStrength}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={setHapticsStrength}
            />
            <p className="settings-panel-note">
              Rebind gamepad buttons and sticks on the General page. Triggers are the raft paddles;
              Start pauses.
            </p>
          </section>
        </>
      )}

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
