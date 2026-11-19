/**
 * useBindingCapture — the Options panel's rebind capture (#559 C, from
 * `SettingsPanel.tsx`).
 *
 * CAPTURE WIDGET: drei has no "listen for next input" helper, so this is one.
 * Capture runs in the UNLOCKED (normal DOM) state — the panel only mounts inside
 * the menu/pause overlays, where the pointer is never locked — so a rebind never
 * fights pointer-lock. A focused "Rebind" button records the next keydown OR
 * mousedown as a Binding; reserved inputs are refused; Escape cancels capture.
 * The gamepad button polls for the next button / stick push instead.
 */
import { useCallback, useEffect, useState } from 'react';
import { detectPadCapture, type PadLike } from '../../input/sources/gamepadMapping';
import { firstStandardPad } from '../../input/menuNav';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import { isReservedKeyCapture, type Binding, type SettingsAction } from '../../systems/settings/settingsDerive';

export interface BindingCapture {
  /** The action whose key / mouse binding is listening, if any. */
  capturing: SettingsAction | null;
  /** The action whose gamepad binding is listening, if any. */
  capturingPad: SettingsAction | null;
  /** The last refused capture, shown under its row. */
  invalid: { action: SettingsAction; msg: string } | null;
  beginCapture: (action: SettingsAction) => void;
  beginPadCapture: (action: SettingsAction) => void;
}

export function useBindingCapture(): BindingCapture {
  const t = useT();
  const bindAction = useSettingsStore((s) => s.bindAction);
  const [capturing, setCapturing] = useState<SettingsAction | null>(null);
  const [capturingPad, setCapturingPad] = useState<SettingsAction | null>(null);
  const [invalid, setInvalid] = useState<{ action: SettingsAction; msg: string } | null>(null);

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

  return { capturing, capturingPad, invalid, beginCapture, beginPadCapture };
}
