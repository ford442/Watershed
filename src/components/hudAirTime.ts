/**
 * The HUD's `AIR! 1.2s` readout (#566), written from the HUD's rAF tick.
 *
 * The tick never calls t() or Intl: the message is split around its
 * `{seconds}` slot once per locale (`airTimeParts`), and the readout writes
 * textContent only when the tenth-of-a-second bucket changes.
 */

import type { TFunction } from '../i18n/i18n';
import { formatFixed } from '../i18n/format';

export interface AirTimeParts {
  prefix: string;
  suffix: string;
  /** The locale's decimal separator ("." / ","). */
  decimal: string;
}

/** The air-time message around its number, for the current locale. Call on a locale change, not per frame. */
export function airTimeParts(t: TFunction): AirTimeParts {
  const SLOT = '\u0000';
  const whole = t('hud.air', { seconds: SLOT });
  const at = whole.indexOf(SLOT);
  return {
    prefix: at < 0 ? whole : whole.slice(0, at),
    suffix: at < 0 ? '' : whole.slice(at + SLOT.length),
    decimal: formatFixed(1.5, 1).replace(/\d/g, '') || '.',
  };
}

export interface AirTimeWriter {
  parts: AirTimeParts;
  /** The bucket on screen (tenths of a second), or -1 for hidden. */
  bucket: number;
}

const VISIBLE_CLASS = 'launch-airtime-hud--visible';

/** Update `el` for `airSeconds`; touches the DOM only when the shown tenth changes. */
export function writeAirTime(el: HTMLElement, airSeconds: number, writer: AirTimeWriter): void {
  const bucket = airSeconds > 0.05 ? Math.round(airSeconds * 10) : -1;
  if (bucket === writer.bucket) return;
  writer.bucket = bucket;
  if (bucket < 0) {
    el.textContent = '';
    el.classList.remove(VISIBLE_CLASS);
    return;
  }
  const { prefix, suffix, decimal } = writer.parts;
  el.textContent = `${prefix}${Math.floor(bucket / 10)}${decimal}${bucket % 10}${suffix}`;
  el.classList.add(VISIBLE_CLASS);
}
