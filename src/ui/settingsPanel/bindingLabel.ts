/**
 * bindingLabel — a binding as the Options panel prints it (#559 C, from
 * `SettingsPanel.tsx`): "W", "Right Click", "A", "Left Stick ↑".
 */
import type { TFunction } from '../../i18n/i18n';
import type { Binding } from '../../systems/settings/settingsDerive';

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

export function bindingLabel(binding: Binding, t: TFunction): string {
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
