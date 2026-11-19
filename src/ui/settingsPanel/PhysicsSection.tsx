/**
 * Options → General → Physics: the physics-worker preference (#559 C, from `SettingsPanel.tsx`).
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';
import type { MessageKey } from '../../i18n/i18n';
import type { PhysicsWorkerPreference } from '../../utils/physicsWorkerFlag';

const PHYSICS_WORKER_LABELS = [
  ['auto', 'settings.auto'],
  ['on', 'settings.on'],
  ['off', 'settings.off'],
] as const satisfies readonly (readonly [PhysicsWorkerPreference, MessageKey])[];

export const PhysicsSection: React.FC = () => {
  const t = useT();
  const physicsWorker = useSettingsStore((s) => s.physicsWorker);
  const setPhysicsWorker = useSettingsStore((s) => s.setPhysicsWorker);

  return (
    <section className="settings-panel-section" aria-label={t('settings.physics.section')}>
      <h3 className="settings-panel-section-title">{t('settings.physics.section')}</h3>
      <div className="settings-panel-row">
        <label className="settings-panel-label">{t('settings.physics.worker')}</label>
        <div className="settings-panel-quality-buttons">
          {PHYSICS_WORKER_LABELS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`settings-panel-quality-btn ${physicsWorker === value ? 'active' : ''}`}
              onClick={() => setPhysicsWorker(value)}
              aria-pressed={physicsWorker === value}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <p className="settings-panel-note">{t('settings.physics.note')}</p>
    </section>
  );
};
