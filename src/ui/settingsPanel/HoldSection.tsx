/**
 * Options → Assist → Hold / toggle: per input, hold or toggle (#558; #559 C,
 * from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import type { MessageKey } from '../../i18n/i18n';
import type { HoldMode } from '../../systems/settings/access';
import { ChoiceRow } from './rows';

const HOLD_INPUTS = [
  ['sprint', 'settings.hold.sprint'],
  ['brake', 'settings.hold.brake'],
  ['paddle', 'settings.hold.paddle'],
] as const satisfies readonly (readonly ['sprint' | 'brake' | 'paddle', MessageKey])[];

const HOLD_LABELS = [
  ['hold', 'settings.hold.hold'],
  ['toggle', 'settings.hold.toggle'],
] as const satisfies readonly (readonly [HoldMode, MessageKey])[];

export const HoldSection: React.FC = () => {
  const t = useT();
  const holdModes = {
    sprint: useSettingsStore((s) => s.sprintMode),
    brake: useSettingsStore((s) => s.brakeMode),
    paddle: useSettingsStore((s) => s.paddleMode),
  };
  const setHoldMode = useSettingsStore((s) => s.setHoldMode);

  return (
    <section className="settings-panel-section" aria-label={t('settings.hold.section')}>
      <h3 className="settings-panel-section-title">{t('settings.hold.section')}</h3>
      {HOLD_INPUTS.map(([input, label]) => (
        <ChoiceRow
          key={input}
          id={`hold-${input}`}
          label={t(label)}
          options={HOLD_LABELS}
          value={holdModes[input]}
          onChange={(v) => setHoldMode(input, v)}
        />
      ))}
      <p className="settings-panel-note">{t('settings.hold.note')}</p>
    </section>
  );
};
