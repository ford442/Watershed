/**
 * Options → General → Audio: one volume slider per channel (#559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import type { MessageKey } from '../../i18n/i18n';
import type { VolumeChannel } from '../../systems/settings/settingsDerive';
import { percent } from './rows';

const VOLUME_CHANNELS = [
  { channel: 'master', label: 'settings.audio.master' },
  { channel: 'music', label: 'settings.audio.music' },
  { channel: 'sfx', label: 'settings.audio.sfx' },
] as const satisfies readonly { channel: VolumeChannel; label: MessageKey }[];

export const AudioSection: React.FC = () => {
  const t = useT();
  const masterVolume = useSettingsStore((s) => s.masterVolume);
  const musicVolume = useSettingsStore((s) => s.musicVolume);
  const sfxVolume = useSettingsStore((s) => s.sfxVolume);
  const setVolume = useSettingsStore((s) => s.setVolume);

  const volumeByChannel: Record<VolumeChannel, number> = {
    master: masterVolume,
    music: musicVolume,
    sfx: sfxVolume,
  };

  return (
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
  );
};
