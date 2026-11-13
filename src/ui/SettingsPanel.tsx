/**
 * SettingsPanel.tsx — Player-facing settings overlay.
 *
 * Reachable from StartMenu ("Options") and PauseMenu. Reads and writes the
 * dedicated `useSettingsStore`. Panel and all setting application are gated on
 * `_hasHydrated` to avoid a flash-of-defaults.
 *
 * This file is the shell — the hydration gate, the page tabs and the footer;
 * each section is its own component under `settingsPanel/` (#559 C) and reads
 * the store itself. The rebind capture (`settingsPanel/useBindingCapture.ts`)
 * is owned here because it also switches menu navigation off while a rebind
 * is listening.
 */

import React, { useRef, useState } from 'react';
import { useMenuFocus } from '../hooks/useMenuFocus';
import { useSettingsStore } from '../systems/settings/useSettingsStore';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/i18n';
import { registerEnglish } from '../i18n/i18n';
import { settingsPanel } from '../i18n/en/lazy/settingsPanel';
import { useBindingCapture } from './settingsPanel/useBindingCapture';
import { LanguageSection } from './settingsPanel/LanguageSection';
import { AudioSection } from './settingsPanel/AudioSection';
import { ControlsSection } from './settingsPanel/ControlsSection';
import { GraphicsSection } from './settingsPanel/GraphicsSection';
import { PhysicsSection } from './settingsPanel/PhysicsSection';
import { ComfortSection } from './settingsPanel/ComfortSection';
import { TouchSection } from './settingsPanel/TouchSection';
import { GamepadSection } from './settingsPanel/GamepadSection';
import { AccessSection } from './settingsPanel/AccessSection';
import { AssistSection } from './settingsPanel/AssistSection';
import { HoldSection } from './settingsPanel/HoldSection';

// This chunk's English rides with it, not the entry (#566).
registerEnglish(settingsPanel);

interface SettingsPanelProps {
  /** Called when the player dismisses the panel (returns to the parent menu). */
  onClose: () => void;
}

const PAGES = [
  ['general', 'settings.page.general'],
  ['comfort', 'settings.page.comfort'],
  ['access', 'settings.page.access'],
  ['assist', 'settings.page.assist'],
] as const satisfies readonly (readonly [SettingsPage, MessageKey])[];

type SettingsPage = 'general' | 'comfort' | 'access' | 'assist';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const t = useT();
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  const [page, setPage] = useState<SettingsPage>('general');
  const capture = useBindingCapture();
  const panelRef = useRef<HTMLDivElement>(null);
  // Arrow keys / d-pad walk the panel; B backs out. Off while a rebind is
  // listening, so the very input being captured is not also navigation.
  useMenuFocus(panelRef, { enabled: capture.capturing === null && capture.capturingPad === null, onBack: onClose });

  if (!hasHydrated) {
    return (
      <div className="settings-panel" role="dialog" aria-label={t('settings.dialog')} aria-busy="true" ref={panelRef}>
        <p className="settings-panel-loading">{t('settings.loading')}</p>
      </div>
    );
  }

  return (
    <div className="settings-panel" role="dialog" aria-label={t('settings.dialog')} ref={panelRef}>
      <h2 className="settings-panel-title">{t('settings.title')}</h2>

      <div className="settings-panel-tabs" role="tablist" aria-label={t('settings.pages')}>
        {PAGES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            className={`settings-panel-tab ${page === id ? 'active' : ''}`}
            onClick={() => setPage(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {page === 'general' && (
        <>
          <LanguageSection />
          <AudioSection />
          <ControlsSection capture={capture} />
          <GraphicsSection />
          <PhysicsSection />
        </>
      )}

      {page === 'comfort' && (
        <>
          <ComfortSection />
          <TouchSection />
          <GamepadSection />
        </>
      )}

      {page === 'access' && <AccessSection />}

      {page === 'assist' && (
        <>
          <AssistSection />
          <HoldSection />
        </>
      )}

      <div className="settings-panel-footer">
        <button
          type="button"
          className="settings-panel-reset-btn"
          onClick={resetToDefaults}
        >
          {t('settings.reset')}
        </button>
        <button type="button" className="settings-panel-close-btn" onClick={onClose}>
          {t('settings.back')}
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;
