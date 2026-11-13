// src/components/PauseMenu.tsx
// Pause overlay with resume, restart, quit, and settings

import React, { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../systems/GameState';
import { useMenuFocus } from '../hooks/useMenuFocus';
import { getActiveMapId } from '../utils/runContext';
import { getRivalGhost, setRivalGhost, clearRivalGhost } from '../systems/persistence/PersistenceSystem';
import { importGhostFromFile } from '../systems/ghost/ghostExport';
import { currentRunFairness, judgeStoredRival } from '../systems/ghost/raceFairness';
import { formatLaunchHour, shortHydroHash } from '../systems/ghost/hydroFairness';
import { useT } from '../i18n/useT';
import { registerEnglish } from '../i18n/i18n';
import { pauseMenu } from '../i18n/en/lazy/pauseMenu';

// This chunk's English rides with it, not the entry (#566).
registerEnglish(pauseMenu);

interface PauseMenuProps {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  /** Open the full Options panel (audio, controls/rebinding, graphics). */
  onOpenOptions: () => void;
}

/**
 * PauseMenu — In-game pause overlay.
 *
 * Features:
 * - Resume button (re-engages pointer lock)
 * - Restart button with confirmation
 * - Quit button (returns to start menu)
 * - Settings panel: graphics quality, sound volume
 * - Keyboard shortcuts: R for restart, Esc to close settings
 */
export const PauseMenu: React.FC<PauseMenuProps> = ({ onResume, onRestart, onQuit, onOpenOptions }) => {
  const t = useT();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const rivalFileInputRef = useRef<HTMLInputElement>(null);

  const ghostEnabled = useGameStore((s) => s.ghostEnabled);
  const setGhostEnabled = useGameStore((s) => s.setGhostEnabled);

  const mapId = getActiveMapId();
  const [rivalLoaded, setRivalLoaded] = useState(() => Boolean(getRivalGhost(mapId)));
  const [rivalStatus, setRivalStatus] = useState('');
  // Why the last import was refused — stays up until the next import/clear so
  // the player can read it (a different hour/hydro hash is never raced).
  const [rivalRefusal, setRivalRefusal] = useState<string | null>(null);

  const fairness = currentRunFairness(mapId);
  const storedRival = rivalLoaded ? judgeStoredRival(mapId) : null;

  const handleRivalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const result = await importGhostFromFile(file, mapId, fairness);
    if (!result.ok) {
      if ('message' in result) {
        setRivalRefusal(t('pause.rivalRefused', { reason: result.message }));
        setRivalStatus(t('pause.rivalStatusRefused'));
      } else {
        setRivalRefusal(null);
        setRivalStatus(result.reason === 'map_mismatch' ? t('pause.rivalWrongMap') : t('pause.rivalInvalid'));
      }
      window.setTimeout(() => setRivalStatus(''), 2500);
      return;
    }

    setRivalGhost(mapId, result.file);
    setRivalLoaded(true);
    setRivalRefusal(null);
    setRivalStatus(t('pause.rivalLoaded'));
    window.setTimeout(() => setRivalStatus(''), 2000);
  };

  const handleClearRival = () => {
    clearRivalGhost(mapId);
    setRivalLoaded(false);
    setRivalRefusal(null);
  };

  // Arrow keys / gamepad d-pad walk the buttons; pad Start or B resumes (B backs
  // out of the restart confirmation first).
  const cardRef = useRef<HTMLDivElement>(null);
  useMenuFocus(cardRef, {
    onBack: () => (confirmRestart ? setConfirmRestart(false) : onResume()),
    onStart: () => {
      if (!confirmRestart) onResume();
    },
  });

  // Focus resume button when pause opens
  useEffect(() => {
    if (!confirmRestart) {
      resumeRef.current?.focus();
    }
  }, [confirmRestart]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (confirmRestart) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setConfirmRestart(false);
        }
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        setConfirmRestart(true);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [confirmRestart]);

  const rivalLine = (
    file: { launchHour?: number; hydroEventHash?: string; qualityPreset?: string },
    unverified: boolean,
  ): string => {
    const hour = file.launchHour !== undefined ? formatLaunchHour(file.launchHour) : t('pause.unknownHour');
    const hash = shortHydroHash(file.hydroEventHash);
    const line = file.qualityPreset
      ? t('pause.rivalLineQuality', { hour, hash, quality: file.qualityPreset })
      : t('pause.rivalLine', { hour, hash });
    return unverified ? t('pause.rivalUnverified', { line }) : line;
  };

  return (
    <div className="pause-menu-overlay">
      <div className="pause-menu-card" ref={cardRef}>
        <h1 className="pause-menu-title">{t('pause.title')}</h1>

        {!confirmRestart && (
          <div className="pause-menu-buttons">
            <button
              ref={resumeRef}
              className="pause-menu-resume-btn"
              onClick={onResume}
              aria-label={`${t('pause.resume')} — ${t('pause.resumeLabel')}`}
            >
              {t('pause.resume')}
              {/* The key hint is for sighted keyboard players; the name already says it (WCAG 2.5.3). */}
              <span className="pause-menu-keyhint" aria-hidden="true">{t('pause.keyEnter')}</span>
            </button>

            <button
              className="pause-menu-restart-btn"
              onClick={() => setConfirmRestart(true)}
              aria-label={`${t('pause.restart')} — ${t('pause.restartLabel')}`}
            >
              {t('pause.restart')}
              <span className="pause-menu-keyhint" aria-hidden="true">{/* the physical key, not a word */ 'R'}</span>
            </button>

            <button
              className="pause-menu-settings-btn"
              onClick={onOpenOptions}
              aria-label={t('pause.optionsLabel')}
            >
              {t('pause.options')}
            </button>

            <button
              className={`pause-menu-ghost-btn ${ghostEnabled ? 'active' : ''}`}
              onClick={() => setGhostEnabled(!ghostEnabled)}
              aria-pressed={ghostEnabled}
              aria-label={`${ghostEnabled ? t('pause.ghostOn') : t('pause.ghostOff')} — ${
                ghostEnabled ? t('pause.ghostHide') : t('pause.ghostShow')
              }`}
            >
              {ghostEnabled ? t('pause.ghostOn') : t('pause.ghostOff')}
            </button>

            <input
              ref={rivalFileInputRef}
              type="file"
              accept=".wsghost,application/json"
              onChange={(e) => {
                handleRivalFileChange(e).catch((err: unknown) => {
                  console.warn('[PauseMenu] rival ghost import failed', err);
                });
              }}
              style={{ display: 'none' }}
            />
            <button
              className={`pause-menu-ghost-btn ${rivalLoaded ? 'active' : ''}`}
              onClick={() =>
                rivalLoaded ? handleClearRival() : rivalFileInputRef.current?.click()
              }
              aria-label={`${rivalLoaded ? t('pause.rivalClear') : t('pause.rivalLoad')} — ${
                rivalLoaded ? t('pause.rivalClearLabel') : t('pause.rivalLoadLabel')
              }`}
            >
              {rivalStatus || (rivalLoaded ? t('pause.rivalClear') : t('pause.rivalLoad'))}
            </button>

            <div className="pause-menu-fairness" aria-live="polite">
              <div>
                {t('pause.racing', {
                  hour: formatLaunchHour(fairness.launchHour ?? 0),
                  map: mapId.toUpperCase(),
                  hash: shortHydroHash(fairness.hydroEventHash),
                  quality: fairness.qualityPreset ?? '',
                })}
              </div>
              {storedRival && (
                <div
                  className={
                    storedRival.verdict.kind === 'refused' ? 'pause-menu-fairness--refused' : undefined
                  }
                >
                  {storedRival.verdict.kind === 'refused'
                    ? t('pause.rivalHidden', { reason: storedRival.verdict.message })
                    : rivalLine(storedRival.file, storedRival.verdict.kind === 'unverified')}
                </div>
              )}
              {rivalRefusal && <div className="pause-menu-fairness--refused">{rivalRefusal}</div>}
            </div>

            <button
              className="pause-menu-quit-btn"
              onClick={onQuit}
              aria-label={t('pause.quitLabel')}
            >
              {t('pause.quit')}
            </button>
          </div>
        )}

        {confirmRestart && (
          <div
            className="pause-menu-confirm"
            role="alertdialog"
            aria-live="assertive"
          >
            <div className="pause-menu-confirm-text">{t('pause.confirm')}</div>
            <div className="pause-menu-confirm-sub">{t('pause.confirmSub')}</div>
            <div className="pause-menu-confirm-buttons">
              <button
                className="pause-menu-confirm-yes"
                onClick={onRestart}
                aria-label={t('pause.yesLabel')}
              >
                {t('pause.yes')}
              </button>
              <button
                className="pause-menu-confirm-no"
                onClick={() => setConfirmRestart(false)}
                aria-label={t('pause.noLabel')}
              >
                {t('pause.no')}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default PauseMenu;
