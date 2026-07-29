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
 * All application is gated on `_hasHydrated` to avoid a flash-of-defaults.
 */

import { useEffect } from 'react';
import { useSettingsStore } from '../systems/useSettingsStore';
import { settingsQualityToLOD } from '../systems/settingsDerive';
import { getAudioManager } from '../systems/AudioSystem';
import { useGameStore } from '../systems/GameState';

export const SettingsSync: React.FC = () => {
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const masterVolume = useSettingsStore((s) => s.masterVolume);
  const musicVolume = useSettingsStore((s) => s.musicVolume);
  const sfxVolume = useSettingsStore((s) => s.sfxVolume);
  const quality = useSettingsStore((s) => s.quality);

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

  return null;
};

export default SettingsSync;
