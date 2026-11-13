/**
 * SettingsSync.tsx — Headless bridge that applies persisted settings to the
 * blind consumers (audio + graphics quality). DOM-level, no R3F required.
 *
 * - Audio: pushes master/music/SFX channel volumes into the AudioManager. Master
 *   is the global listener gain; music/SFX are multipliers ReactiveAudio reads
 *   transiently each frame, coexisting with the biome/speed ducking.
 * - Graphics: maps the settings-panel quality preset onto the existing
 *   GameState.settings.quality, which already drives LOD + post-processing LIVE
 *   (LODManager syncs from it) — so effect toggles apply with no renderer churn.
 *
 * - Language: resolves the `locale` choice (or navigator.languages under 'system')
 *   and loads that catalog; text re-renders through useT.
 *
 * - Access (#558): the UI scale and colour-vision palette go onto <html> as CSS
 *   custom properties (`--ui-scale`, `--a11y-*`, `data-contrast`); captions,
 *   assists and hold / toggle go to the store-free accessRuntime the sim reads.
 *
 * All application is gated on `_hasHydrated` to avoid a flash-of-defaults.
 */

import { useEffect } from 'react';
import { useSettingsStore } from '../systems/settings/useSettingsStore';
import { settingsQualityToLOD } from '../systems/settings/settingsDerive';
import { getAudioManager } from '../systems/audio/AudioSystem';
import { useGameStore } from '../systems/GameState';
import { setLocale } from '../i18n/i18n';
import { browserLanguages, resolveLocale } from '../i18n/resolveLocale';
import { PALETTE_KEYS, UI_SCALE_MAX, UI_SCALE_MIN, paletteCssVar } from '../systems/settings/access';
import {
  setCaptionsEnabled,
  setColorVisionMode,
  setHoldModes,
  setLiveAssists,
} from '../systems/settings/accessRuntime';
import { queryParam } from '../config/queryFlags';
import { clamp } from '../math/scalar';

/** `?uiScale=1.5` — the harness's override (visual smoke shoots 150 % / 200 %). */
function uiScaleOverride(): number | null {
  const raw = queryParam('uiScale');
  if (raw === null) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? clamp(v, UI_SCALE_MIN, UI_SCALE_MAX) : null;
}

export const SettingsSync: React.FC = () => {
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const masterVolume = useSettingsStore((s) => s.masterVolume);
  const musicVolume = useSettingsStore((s) => s.musicVolume);
  const sfxVolume = useSettingsStore((s) => s.sfxVolume);
  const quality = useSettingsStore((s) => s.quality);
  const locale = useSettingsStore((s) => s.locale);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const colorVision = useSettingsStore((s) => s.colorVision);
  const captions = useSettingsStore((s) => s.captions);
  const gameSpeed = useSettingsStore((s) => s.gameSpeed);
  const nonLethal = useSettingsStore((s) => s.nonLethal);
  const guideRibbon = useSettingsStore((s) => s.guideRibbon);
  const autoJump = useSettingsStore((s) => s.autoJump);
  const sprintMode = useSettingsStore((s) => s.sprintMode);
  const brakeMode = useSettingsStore((s) => s.brakeMode);
  const paddleMode = useSettingsStore((s) => s.paddleMode);

  // Apply audio channels. The AudioManager is a singleton created when the
  // experience mounts; if it isn't ready yet, retry on rAF until it is, then
  // stop. Subsequent value changes re-run this effect and re-apply immediately.
  useEffect(() => {
    if (!hasHydrated) return;
    let raf = 0;
    let tries = 0;
    const apply = () => {
      const am = getAudioManager();
      if (am) {
        am.setMasterVolume(masterVolume);
        am.setMusicVolume(musicVolume);
        am.setSfxVolume(sfxVolume);
        return;
      }
      if (tries++ < 600) raf = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [hasHydrated, masterVolume, musicVolume, sfxVolume]);

  // Apply graphics quality via the existing GameState plumbing.
  useEffect(() => {
    if (!hasHydrated) return;
    const lodQuality = settingsQualityToLOD(quality);
    const gs = useGameStore.getState();
    if (gs.settings.quality !== lodQuality) {
      gs.setSettings({ quality: lodQuality });
    }
  }, [hasHydrated, quality]);

  // Apply the UI language. A failed chunk fetch leaves the current language up.
  useEffect(() => {
    if (!hasHydrated) return;
    setLocale(resolveLocale(locale, browserLanguages())).catch((error: unknown) => {
      console.warn('[i18n] locale load failed; keeping the current language', error);
    });
  }, [hasHydrated, locale]);

  // UI scale: the root font size is `100% × --ui-scale`, so browser zoom and the
  // OS text size still multiply it. Applied before hydration too (a ?uiScale=
  // harness shot must not wait for storage).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scale = uiScaleOverride() ?? (hasHydrated ? uiScale : 1);
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  }, [hasHydrated, uiScale]);

  // Colour vision: one palette → custom properties every HUD tint reads. The
  // authored palette is access.css's defaults, so 'off' just clears the
  // overrides; the other modes fetch palettes.ts (a lazy chunk) first.
  useEffect(() => {
    if (!hasHydrated || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    // The high-contrast mode also turns on access.css's opaque panels.
    if (colorVision === 'highContrast') root.dataset.contrast = 'more';
    else delete root.dataset.contrast;
    if (colorVision === 'off') {
      for (const key of PALETTE_KEYS) root.style.removeProperty(paletteCssVar(key));
      delete root.dataset.cvd;
      setColorVisionMode('off');
      return undefined;
    }
    let cancelled = false;
    void import('../systems/settings/palettes').then(({ paletteFor }) => {
      if (cancelled) return;
      const palette = paletteFor(colorVision);
      for (const key of PALETTE_KEYS) root.style.setProperty(paletteCssVar(key), palette[key]);
      root.dataset.cvd = colorVision;
      setColorVisionMode(colorVision, palette);
    });
    return () => {
      cancelled = true;
    };
  }, [hasHydrated, colorVision]);

  useEffect(() => {
    if (!hasHydrated) return;
    setCaptionsEnabled(captions);
  }, [hasHydrated, captions]);

  // Assists → the sim (store-free). Before hydration the runtime holds none.
  useEffect(() => {
    if (!hasHydrated) return;
    setLiveAssists({ gameSpeed, nonLethal, guideRibbon, autoJump });
  }, [hasHydrated, gameSpeed, nonLethal, guideRibbon, autoJump]);

  useEffect(() => {
    if (!hasHydrated) return;
    setHoldModes({ sprint: sprintMode, brake: brakeMode, paddle: paddleMode });
  }, [hasHydrated, sprintMode, brakeMode, paddleMode]);

  return null;
};
