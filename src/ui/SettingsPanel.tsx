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
import { useT } from '../i18n/useT';
import type { MessageKey, PlainKey, TFunction } from '../i18n/i18n';
import { formatFixed, formatNumber, formatPercent } from '../i18n/format';
import type { LocalePref } from '../i18n/types';
import {
  GAME_SPEED_MAX,
  GAME_SPEED_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  type ColorVisionMode,
  type HoldMode,
} from '../systems/settings/access';
import { registerEnglish } from '../i18n/i18n';
import { settingsPanel } from '../i18n/en/lazy/settingsPanel';

// This chunk's English rides with it, not the entry (#566).
registerEnglish(settingsPanel);

interface SettingsPanelProps {
  /** Called when the player dismisses the panel (returns to the parent menu). */
  onClose: () => void;
}

const MOUSE_KEYS: Partial<Record<string, 'settings.input.mouseLeft' | 'settings.input.mouseMiddle' | 'settings.input.mouseRight'>> = {
  Mouse0: 'settings.input.mouseLeft',
  Mouse1: 'settings.input.mouseMiddle',
  Mouse2: 'settings.input.mouseRight',
};

/**
 * Standard-mapping names, so a pad binding reads "A" or "Left Stick ↑" rather than
 * "Button0". Face / shoulder letters are printed on the pad and stay as they are;
 * the named ones translate.
 */
const PAD_BUTTON_GLYPHS: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 10: 'L3', 11: 'R3',
};
const PAD_BUTTON_KEYS: Partial<
  Record<
    number,
    | 'settings.input.padBack'
    | 'settings.input.padStart'
    | 'settings.input.dpadUp'
    | 'settings.input.dpadDown'
    | 'settings.input.dpadLeft'
    | 'settings.input.dpadRight'
  >
> = {
  8: 'settings.input.padBack',
  9: 'settings.input.padStart',
  12: 'settings.input.dpadUp',
  13: 'settings.input.dpadDown',
  14: 'settings.input.dpadLeft',
  15: 'settings.input.dpadRight',
};
const PAD_AXES: Record<number, { stick: 'left' | 'right'; arrows: [string, string] }> = {
  0: { stick: 'left', arrows: ['←', '→'] },
  1: { stick: 'left', arrows: ['↑', '↓'] },
  2: { stick: 'right', arrows: ['←', '→'] },
  3: { stick: 'right', arrows: ['↑', '↓'] },
};

function bindingLabel(binding: Binding, t: TFunction): string {
  if (binding.kind === 'gamepad-button') {
    const n = Number(binding.code.slice(6));
    const key = PAD_BUTTON_KEYS[n];
    if (key) return t(key);
    return PAD_BUTTON_GLYPHS[n] ?? t('settings.input.button', { n: String(n) });
  }
  if (binding.kind === 'gamepad-axis') {
    const n = Number(binding.code.slice(4, -1));
    const positive = binding.code.endsWith('+');
    const axis = PAD_AXES[n];
    if (!axis) return t('settings.input.axis', { n: String(n), sign: positive ? '+' : '−' });
    const arrow = axis.arrows[positive ? 1 : 0];
    return axis.stick === 'left'
      ? t('settings.input.leftStick', { arrow })
      : t('settings.input.rightStick', { arrow });
  }
  if (binding.kind === 'mouse') {
    const key = MOUSE_KEYS[binding.code];
    return key ? t(key) : binding.code;
  }
  // Key names follow event.code: 'KeyW' → 'W', 'ArrowUp' → 'Arrow Up'.
  if (binding.code.startsWith('Key')) return binding.code.slice(3);
  if (binding.code.startsWith('Digit')) return binding.code.slice(5);
  if (binding.code === 'Space') return t('settings.input.space');
  return binding.code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

const VOLUME_CHANNELS = [
  { channel: 'master', label: 'settings.audio.master' },
  { channel: 'music', label: 'settings.audio.music' },
  { channel: 'sfx', label: 'settings.audio.sfx' },
] as const satisfies readonly { channel: VolumeChannel; label: MessageKey }[];

const LOCALE_OPTIONS = [
  ['system', 'locale.system'],
  ['en', 'locale.en'],
  ['es', 'locale.es'],
  ['fr', 'locale.fr'],
] as const satisfies readonly (readonly [LocalePref, MessageKey])[];

const percent = (v: number) => formatPercent(v);

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
}) => {
  const t = useT();
  return (
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
        {value ? t('settings.on') : t('settings.off')}
      </button>
    </div>
  );
};

const REDUCED_MOTION_LABELS = [
  ['system', 'settings.system'],
  ['on', 'settings.on'],
  ['off', 'settings.off'],
] as const satisfies readonly (readonly [ReducedMotionPref, MessageKey])[];

const PHYSICS_WORKER_LABELS = [
  ['auto', 'settings.auto'],
  ['on', 'settings.on'],
  ['off', 'settings.off'],
] as const satisfies readonly (readonly [PhysicsWorkerPreference, MessageKey])[];

const PAGES = [
  ['general', 'settings.page.general'],
  ['comfort', 'settings.page.comfort'],
  ['access', 'settings.page.access'],
  ['assist', 'settings.page.assist'],
] as const satisfies readonly (readonly [SettingsPage, MessageKey])[];

type SettingsPage = 'general' | 'comfort' | 'access' | 'assist';

const COLOR_VISION_LABELS = [
  ['off', 'settings.cvd.off'],
  ['deuteranopia', 'settings.cvd.deuteranopia'],
  ['protanopia', 'settings.cvd.protanopia'],
  ['tritanopia', 'settings.cvd.tritanopia'],
  ['highContrast', 'settings.cvd.highContrast'],
] as const satisfies readonly (readonly [ColorVisionMode, MessageKey])[];

const HOLD_INPUTS = [
  ['sprint', 'settings.hold.sprint'],
  ['brake', 'settings.hold.brake'],
  ['paddle', 'settings.hold.paddle'],
] as const satisfies readonly (readonly ['sprint' | 'brake' | 'paddle', MessageKey])[];

const HOLD_LABELS = [
  ['hold', 'settings.hold.hold'],
  ['toggle', 'settings.hold.toggle'],
] as const satisfies readonly (readonly [HoldMode, MessageKey])[];

/** A row of mutually exclusive buttons (radio group), labelled. */
function ChoiceRow<V extends string>({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly (readonly [V, PlainKey])[];
  value: V;
  onChange: (v: V) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="settings-panel-row">
      <span className="settings-panel-label" id={`${id}-label`}>
        {label}
      </span>
      <div className="settings-panel-quality-buttons" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map(([v, key]) => (
          <button
            key={v}
            type="button"
            role="radio"
            className={`settings-panel-quality-btn ${value === v ? 'active' : ''}`}
            onClick={() => onChange(v)}
            aria-checked={value === v}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const t = useT();
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
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setUiScale = useSettingsStore((s) => s.setUiScale);
  const colorVision = useSettingsStore((s) => s.colorVision);
  const setColorVision = useSettingsStore((s) => s.setColorVision);
  const captions = useSettingsStore((s) => s.captions);
  const setCaptions = useSettingsStore((s) => s.setCaptions);
  const gameSpeed = useSettingsStore((s) => s.gameSpeed);
  const setGameSpeed = useSettingsStore((s) => s.setGameSpeed);
  const nonLethal = useSettingsStore((s) => s.nonLethal);
  const setNonLethal = useSettingsStore((s) => s.setNonLethal);
  const guideRibbon = useSettingsStore((s) => s.guideRibbon);
  const setGuideRibbon = useSettingsStore((s) => s.setGuideRibbon);
  const autoJump = useSettingsStore((s) => s.autoJump);
  const setAutoJump = useSettingsStore((s) => s.setAutoJump);
  const holdModes = {
    sprint: useSettingsStore((s) => s.sprintMode),
    brake: useSettingsStore((s) => s.brakeMode),
    paddle: useSettingsStore((s) => s.paddleMode),
  };
  const setHoldMode = useSettingsStore((s) => s.setHoldMode);

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
        setInvalid({ action, msg: t('settings.bind.reserved') });
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
  }, [capturing, bindAction, t]);

  if (!hasHydrated) {
    return (
      <div className="settings-panel" role="dialog" aria-label={t('settings.dialog')} aria-busy="true" ref={panelRef}>
        <p className="settings-panel-loading">{t('settings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="settings-panel" role="dialog" aria-label={t('settings.dialog')} ref={panelRef}>
      <h2 className="settings-panel-title">{t('settings.title')}</h2>

      <div className="settings-panel-tabs" role="tablist" aria-label={t('settings.pages')}>
        {PAGES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            className={`settings-panel-tab ${page === id ? 'active' : ''}`}
            onClick={() => setPage(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {page === 'access' && (
        <>
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
        </>
      )}

      {page === 'assist' && (
        <>
          <section className="settings-panel-section" aria-label={t('settings.assist.section')}>
            <h3 className="settings-panel-section-title">{t('settings.assist.section')}</h3>
            <SliderRow
              id="assist-game-speed"
              label={t('settings.assist.gameSpeed')}
              min={GAME_SPEED_MIN}
              max={GAME_SPEED_MAX}
              step={0.05}
              value={gameSpeed}
              format={percent}
              onChange={setGameSpeed}
            />
            <ToggleRow id="assist-non-lethal" label={t('settings.assist.nonLethal')} value={nonLethal} onChange={setNonLethal} />
            <ToggleRow
              id="assist-guide-ribbon"
              label={t('settings.assist.guideRibbon')}
              value={guideRibbon}
              onChange={setGuideRibbon}
            />
            <ToggleRow id="assist-auto-jump" label={t('settings.assist.autoJump')} value={autoJump} onChange={setAutoJump} />
            <p className="settings-panel-note">{t('settings.assist.note')}</p>
          </section>
          <section className="settings-panel-section" aria-label={t('settings.hold.section')}>
            <h3 className="settings-panel-section-title">{t('settings.hold.section')}</h3>
            {HOLD_INPUTS.map(([input, label]) => (
              <ChoiceRow
                key={input}
                id={`hold-${input}`}
                label={t(label)}
                options={HOLD_LABELS}
                value={holdModes[input]}
                onChange={(v) => setHoldMode(input, v)}
              />
            ))}
            <p className="settings-panel-note">{t('settings.hold.note')}</p>
          </section>
        </>
      )}

      {page === 'access' || page === 'assist' ? null : page === 'general' ? (
        <>

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

      <section className="settings-panel-section" aria-label={t('settings.audio.section')}>
        <h3 className="settings-panel-section-title">{t('settings.audio.section')}</h3>
        {VOLUME_CHANNELS.map(({ channel, label }) => (
          <div className="settings-panel-row" key={channel}>
            <label className="settings-panel-label" htmlFor={`vol-${channel}`}>
              {t('settings.audio.volume', { channel: t(label) })}
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
            <span className="settings-panel-value">{percent(volumeByChannel[channel])}</span>
          </div>
        ))}
      </section>

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

      <section className="settings-panel-section" aria-label={t('settings.physics.section')}>
        <h3 className="settings-panel-section-title">{t('settings.physics.section')}</h3>
        <div className="settings-panel-row">
          <label className="settings-panel-label">{t('settings.physics.worker')}</label>
          <div className="settings-panel-quality-buttons">
            {PHYSICS_WORKER_LABELS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`settings-panel-quality-btn ${physicsWorker === value ? 'active' : ''}`}
                onClick={() => setPhysicsWorker(value)}
                aria-pressed={physicsWorker === value}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        <p className="settings-panel-note">{t('settings.physics.note')}</p>
      </section>

        </>
      ) : (
        <>
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

          <section className="settings-panel-section" aria-label={t('settings.touch.section')}>
            <h3 className="settings-panel-section-title">{t('settings.touch.section')}</h3>
            <ToggleRow id="touch-left-handed" label={t('settings.touch.leftHanded')} value={leftHanded} onChange={setLeftHanded} />
          </section>

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
        </>
      )}

      <div className="settings-panel-footer">
        <button
          type="button"
          className="settings-panel-reset-btn"
          onClick={resetToDefaults}
        >
          {t('settings.reset')}
        </button>
        <button type="button" className="settings-panel-close-btn" onClick={onClose}>
          {t('settings.back')}
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;
