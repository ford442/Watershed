/**
 * palettes.ts — the colour-vision palettes (#558 C.2), a lazy chunk: a player
 * on the authored palette never fetches it (SettingsSync imports it on demand).
 */

import { AUTHORED_PALETTE, type AccessPalette, type ColorVisionMode } from './access';

const AUTHORED = AUTHORED_PALETTE;

/*
 * Red–green (deuteranopia, protanopia): the blue / yellow / vermilion axis of
 * the Okabe–Ito set, ordered by lightness as well as hue so the three steps
 * also part in greyscale. Protanopes see long-wave red dark, so their "bad"
 * is the lighter orange rather than vermilion.
 */
const RED_GREEN: AccessPalette = {
  ok: '#56b4e9',
  warn: '#f0e442',
  bad: '#d55e00',
  neutral: '#f8fafc',
  wetLow: '#9aa5b1',
  wetMid: '#56b4e9',
  wetHigh: '#0072b2',
  ahead: '#56b4e9',
  behind: '#e69f00',
  riskNormal: '#56b4e9',
  riskHigh: '#f0e442',
  riskFlood: '#d55e00',
  riskWashout: '#cc79a7',
  telegraphArmed: '#f0e442',
  telegraphWarn: '#e69f00',
  telegraphActive: '#d55e00',
};

const PALETTES: Record<ColorVisionMode, AccessPalette> = {
  off: AUTHORED,
  deuteranopia: RED_GREEN,
  protanopia: { ...RED_GREEN, bad: '#e69f00', behind: '#e69f00', riskFlood: '#e69f00', telegraphActive: '#ff8c1a', telegraphWarn: '#f0e442', telegraphArmed: '#ffffff' },
  // Blue–yellow (tritanopia): the red / teal axis instead.
  tritanopia: {
    ok: '#00c2c7',
    warn: '#ff8fa3',
    bad: '#e0002a',
    neutral: '#f8fafc',
    wetLow: '#a0a0a0',
    wetMid: '#00c2c7',
    wetHigh: '#008b8f',
    ahead: '#00c2c7',
    behind: '#e0002a',
    riskNormal: '#00c2c7',
    riskHigh: '#ff8fa3',
    riskFlood: '#e0002a',
    riskWashout: '#ffffff',
    telegraphArmed: '#ff8fa3',
    telegraphWarn: '#ff4d6d',
    telegraphActive: '#e0002a',
  },
  // Saturated, maximal-luminance steps on the opaque panels contrast.css draws.
  highContrast: {
    ok: '#00ff66',
    warn: '#ffff00',
    bad: '#ff3030',
    neutral: '#ffffff',
    wetLow: '#ffffff',
    wetMid: '#66ccff',
    wetHigh: '#00a2ff',
    ahead: '#00ff66',
    behind: '#ff3030',
    riskNormal: '#00ff66',
    riskHigh: '#ffff00',
    riskFlood: '#ff3030',
    riskWashout: '#ff00ff',
    telegraphArmed: '#ffff00',
    telegraphWarn: '#ff9900',
    telegraphActive: '#ff0000',
  },
};

export function paletteFor(mode: ColorVisionMode): Readonly<AccessPalette> {
  return PALETTES[mode] ?? AUTHORED;
}
