/**
 * Options → Assist: game speed, non-lethal survival, the centreline guide,
 * auto-jump (#558; #559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import { GAME_SPEED_MAX, GAME_SPEED_MIN } from '../../systems/settings/access';
import { percent, SliderRow, ToggleRow } from './rows';

export const AssistSection: React.FC = () => {
  const t = useT();
  const gameSpeed = useSettingsStore((s) => s.gameSpeed);
  const setGameSpeed = useSettingsStore((s) => s.setGameSpeed);
  const nonLethal = useSettingsStore((s) => s.nonLethal);
  const setNonLethal = useSettingsStore((s) => s.setNonLethal);
  const guideRibbon = useSettingsStore((s) => s.guideRibbon);
  const setGuideRibbon = useSettingsStore((s) => s.setGuideRibbon);
  const autoJump = useSettingsStore((s) => s.autoJump);
  const setAutoJump = useSettingsStore((s) => s.setAutoJump);

  return (
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
  );
};
