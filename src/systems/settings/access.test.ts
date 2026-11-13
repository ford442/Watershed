import { describe, expect, it, beforeEach } from 'vitest';
import {
  ASSIST_AUTO_JUMP,
  ASSIST_GAME_SPEED,
  ASSIST_NON_LETHAL,
  COLOR_VISION_MODES,
  NO_ASSISTS,
  PALETTE_KEYS,
  assistBits,
  assistRunKeyTag,
  exposureGrade,
  paletteCssVar,
  sanitizeAssistBits,
  staminaGrade,
  wetnessStep,
} from './access';
import { paletteFor } from './palettes';
import {
  beginRunAssists,
  getAccessPalette,
  getRunAssistBits,
  resetAccessRuntimeForTests,
  setColorVisionMode,
  setLiveAssists,
} from './accessRuntime';

describe('access palette (#558 C.2)', () => {
  it('every mode defines every colour, as a hex', () => {
    for (const mode of COLOR_VISION_MODES) {
      const p = paletteFor(mode);
      for (const key of PALETTE_KEYS) expect(p[key], `${mode}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('each red–green / blue–yellow mode keeps ok, warn and bad apart', () => {
    for (const mode of COLOR_VISION_MODES) {
      const p = paletteFor(mode);
      expect(new Set([p.ok, p.warn, p.bad]).size, mode).toBe(3);
      expect(new Set([p.riskNormal, p.riskHigh, p.riskFlood, p.riskWashout]).size, mode).toBe(4);
    }
  });

  it('the red–green modes drop the red / green pair the authored palette uses', () => {
    expect(paletteFor('deuteranopia').ok).not.toBe(paletteFor('off').ok);
    expect(paletteFor('protanopia').bad).not.toBe(paletteFor('off').bad);
  });

  it('publishes as kebab-case custom properties', () => {
    expect(paletteCssVar('ok')).toBe('--a11y-ok');
    expect(paletteCssVar('riskWashout')).toBe('--a11y-risk-washout');
  });

  it('the runtime palette follows the mode', () => {
    resetAccessRuntimeForTests();
    expect(getAccessPalette()).toBe(paletteFor('off'));
    setColorVisionMode('tritanopia', paletteFor('tritanopia'));
    expect(getAccessPalette().bad).toBe(paletteFor('tritanopia').bad);
    resetAccessRuntimeForTests();
  });
});

describe('graded HUD states (#558 C.1)', () => {
  it('match the thresholds the HUD always coloured at', () => {
    expect([staminaGrade(1), staminaGrade(0.3), staminaGrade(0.1)]).toEqual(['ok', 'warn', 'bad']);
    expect([exposureGrade(0.1), exposureGrade(0.5), exposureGrade(0.9)]).toEqual(['ok', 'warn', 'bad']);
    expect([wetnessStep(0.1), wetnessStep(0.5), wetnessStep(0.9)]).toEqual(['dry', 'damp', 'soaked']);
  });
});

describe('assists bitfield (#558 D.2)', () => {
  beforeEach(() => resetAccessRuntimeForTests());

  it('no assists is 0 and adds nothing to a run key', () => {
    expect(assistBits(NO_ASSISTS)).toBe(0);
    expect(assistRunKeyTag(0)).toBe('');
  });

  it('each assist sets its bit', () => {
    expect(assistBits({ ...NO_ASSISTS, gameSpeed: 0.8 })).toBe(ASSIST_GAME_SPEED);
    expect(assistBits({ ...NO_ASSISTS, nonLethal: true, autoJump: true })).toBe(ASSIST_NON_LETHAL | ASSIST_AUTO_JUMP);
    expect(assistRunKeyTag(ASSIST_NON_LETHAL | ASSIST_AUTO_JUMP)).toBe('~aa');
  });

  it('sanitises imported bits', () => {
    expect(sanitizeAssistBits('3')).toBe(0);
    expect(sanitizeAssistBits(-1)).toBe(0);
    expect(sanitizeAssistBits(1.5)).toBe(0);
    expect(sanitizeAssistBits(0xff)).toBe(0xf);
  });

  it('run bits are sticky until the next run starts', () => {
    setLiveAssists({ ...NO_ASSISTS, nonLethal: true });
    setLiveAssists(NO_ASSISTS);
    expect(getRunAssistBits()).toBe(ASSIST_NON_LETHAL);
    beginRunAssists();
    expect(getRunAssistBits()).toBe(0);
  });
});
