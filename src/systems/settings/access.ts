/**
 * access.ts — the access settings' vocabulary (#558): UI scale and game-speed
 * ranges, colour-vision modes and the one palette every coloured HUD state and
 * in-world telegraph reads, and the assists bitfield a run records.
 *
 * Pure data and pure functions: no store, no DOM. The live values sit in
 * `accessRuntime.ts`; SettingsSync writes the palette to CSS custom properties.
 */

export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 2;
export const GAME_SPEED_MIN = 0.7;
export const GAME_SPEED_MAX = 1;

export const COLOR_VISION_MODES = ['off', 'deuteranopia', 'protanopia', 'tritanopia', 'highContrast'] as const;
export type ColorVisionMode = (typeof COLOR_VISION_MODES)[number];

/** Whether an input acts while held, or flips on each press. */
export type HoldMode = 'hold' | 'toggle';

// ---------------------------------------------------------------------------
// Palette (the authored one; the colour-vision modes live in palettes.ts)
// ---------------------------------------------------------------------------

/**
 * Every colour that carries meaning. A coloured state never relies on its
 * colour alone (each also has a glyph and a word, #558 C.1); the palette makes
 * the colour itself readable for the player's eyes.
 */
export interface AccessPalette {
  /** Fine / plenty / safe. */
  ok: string;
  /** Watch it. */
  warn: string;
  /** Trouble. */
  bad: string;
  /** Untinted HUD text. */
  neutral: string;
  /** Wetness, low → high (a quantity, not a verdict). */
  wetLow: string;
  wetMid: string;
  wetHigh: string;
  /** Ghost split ahead / behind. */
  ahead: string;
  behind: string;
  /** Forecast states. */
  riskNormal: string;
  riskHigh: string;
  riskFlood: string;
  riskWashout: string;
  /** In-world hazard telegraph (decal + rim light), by phase. */
  telegraphArmed: string;
  telegraphWarn: string;
  telegraphActive: string;
}

const AUTHORED: AccessPalette = {
  ok: '#86efac',
  warn: '#fbbf24',
  bad: '#ef4444',
  neutral: '#f8fafc',
  wetLow: '#94a3b8',
  wetMid: '#7dd3fc',
  wetHigh: '#38bdf8',
  ahead: '#4cff7c',
  behind: '#ff4c4c',
  riskNormal: '#89d18b',
  riskHigh: '#f3c969',
  riskFlood: '#ff7f6e',
  riskWashout: '#c44bff',
  telegraphArmed: '#ffd166',
  telegraphWarn: '#ff9f1c',
  telegraphActive: '#ff3b30',
};

/** The authored palette (`'off'`). The other modes are a lazy chunk: `palettes.ts`. */
export const AUTHORED_PALETTE: Readonly<AccessPalette> = AUTHORED;

/** `ok` → `--a11y-ok`: the custom property each palette entry is published as. */
export function paletteCssVar(key: keyof AccessPalette): string {
  return `--a11y-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export const PALETTE_KEYS = Object.keys(AUTHORED) as (keyof AccessPalette)[];

// ---------------------------------------------------------------------------
// Graded states: a colour, a glyph and a word for every coloured HUD bar
// ---------------------------------------------------------------------------

/** Three steps every bar and readout grades into. */
export type Grade = 'ok' | 'warn' | 'bad';

/** Shape per grade: distinct outlines, so the step reads without colour. */
export const GRADE_GLYPH: Record<Grade, string> = { ok: '●', warn: '▲', bad: '✖' };

/** Sprint stamina, 0–1: low is trouble. */
export function staminaGrade(stamina: number): Grade {
  return stamina >= 0.5 ? 'ok' : stamina >= 0.25 ? 'warn' : 'bad';
}

/** Exposure / cold stress, 0–1: high is trouble. */
export function exposureGrade(stress: number): Grade {
  return stress > 0.6 ? 'bad' : stress > 0.3 ? 'warn' : 'ok';
}

/** Wetness, 0–1: a quantity in three steps (dry / damp / soaked). */
export type WetStep = 'dry' | 'damp' | 'soaked';
export function wetnessStep(wetness: number): WetStep {
  return wetness > 0.65 ? 'soaked' : wetness > 0.3 ? 'damp' : 'dry';
}
export const WET_GLYPH: Record<WetStep, string> = { dry: '○', damp: '◐', soaked: '●' };

/** Score multiplier tiers (the HUD's ×N tint). */
export function multiplierGrade(multiplier: number): Grade {
  return multiplier >= 7 ? 'bad' : multiplier >= 3 ? 'warn' : 'ok';
}

// ---------------------------------------------------------------------------
// Assists bitfield (#558 D.2)
// ---------------------------------------------------------------------------

export const ASSIST_GAME_SPEED = 1 << 0;
export const ASSIST_NON_LETHAL = 1 << 1;
export const ASSIST_GUIDE_RIBBON = 1 << 2;
export const ASSIST_AUTO_JUMP = 1 << 3;

/** The assists that change what a run can do. Hold / toggle is an input preference, like a rebind. */
export interface AssistSettings {
  gameSpeed: number;
  nonLethal: boolean;
  guideRibbon: boolean;
  autoJump: boolean;
}

export const NO_ASSISTS: Readonly<AssistSettings> = Object.freeze({
  gameSpeed: 1,
  nonLethal: false,
  guideRibbon: false,
  autoJump: false,
});

export function assistBits(a: Readonly<AssistSettings>): number {
  let bits = 0;
  if (a.gameSpeed < 1 - 1e-6) bits |= ASSIST_GAME_SPEED;
  if (a.nonLethal) bits |= ASSIST_NON_LETHAL;
  if (a.guideRibbon) bits |= ASSIST_GUIDE_RIBBON;
  if (a.autoJump) bits |= ASSIST_AUTO_JUMP;
  return bits;
}

/** Normalise a stored / imported bitfield (unknown bits dropped, non-numbers → 0). */
export function sanitizeAssistBits(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return 0;
  return v & (ASSIST_GAME_SPEED | ASSIST_NON_LETHAL | ASSIST_GUIDE_RIBBON | ASSIST_AUTO_JUMP);
}

/**
 * The assists tag of a run key (`~a3`): '' when none, so an unassisted run keeps
 * the key it always had (and the smokes stay identical to main). It goes right
 * after the map id — `meander~a3:12345`, `meander~a3@2026-10-21:12345` — so a
 * `meander:` prefix scan (best score per map) and the Daily River's `@date:`
 * pruning both still read the key, and an assisted best never stands as the map's.
 */
export function assistRunKeyTag(bits: number): string {
  return bits ? `~a${bits.toString(16)}` : '';
}
