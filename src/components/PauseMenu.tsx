// src/components/PauseMenu.tsx
// Pause overlay with resume, restart, quit, and settings

import React, { useState, useEffect, useRef } from 'react';
import { useGameStore, type QualityPreset } from '../systems/GameState';

interface PauseMenuProps {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

const QUALITY_LABELS: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

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
export const PauseMenu: React.FC<PauseMenuProps> = ({ onResume, onRestart, onQuit }) => {
  const [showSettings, setShowSettings] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const resumeRef = useRef<HTMLButtonElement>(null);

  const settings = useGameStore((s) => s.settings);
  const ghostEnabled = useGameStore((s) => s.ghostEnabled);
  const setSettings = useGameStore((s) => s.setSettings);
  const setGhostEnabled = useGameStore((s) => s.setGhostEnabled);

  // Focus resume button when pause opens
  useEffect(() => {
    if (!showSettings && !confirmRestart) {
      resumeRef.current?.focus();
    }
  }, [showSettings, confirmRestart]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (showSettings) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowSettings(false);
        }
        return;
      }
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
  }, [showSettings, confirmRestart]);

  const handleQualityChange = (quality: QualityPreset) => {
    setSettings({ quality });
  };

  return (
    <div className="pause-menu-overlay">
      <div className="pause-menu-card">
        <h1 className="pause-menu-title">PAUSED</h1>

        {!showSettings && !confirmRestart && (
          <div className="pause-menu-buttons">
            <button
              ref={resumeRef}
              className="pause-menu-resume-btn"
              onClick={onResume}
              aria-label="Resume Game"
            >
              RESUME
              <span className="pause-menu-keyhint">ENTER</span>
            </button>

            <button
              className="pause-menu-restart-btn"
              onClick={() => setConfirmRestart(true)}
              aria-label="Restart Game"
            >
              RESTART
              <span className="pause-menu-keyhint">R</span>
            </button>

            <button
              className="pause-menu-settings-btn"
              onClick={() => setShowSettings(true)}
              aria-label="Open Settings"
            >
              SETTINGS
            </button>

            <button
              className={`pause-menu-ghost-btn ${ghostEnabled ? 'active' : ''}`}
              onClick={() => setGhostEnabled(!ghostEnabled)}
              aria-pressed={ghostEnabled}
              aria-label={ghostEnabled ? 'Hide best-run ghost' : 'Show best-run ghost'}
            >
              GHOST: {ghostEnabled ? 'ON' : 'OFF'}
            </button>

            <button
              className="pause-menu-quit-btn"
              onClick={onQuit}
              aria-label="Quit to Main Menu"
            >
              QUIT
            </button>
          </div>
        )}

        {confirmRestart && (
          <div
            className="pause-menu-confirm"
            role="alertdialog"
            aria-live="assertive"
          >
            <div className="pause-menu-confirm-text">RESTART RUN?</div>
            <div className="pause-menu-confirm-sub">Progress will be lost.</div>
            <div className="pause-menu-confirm-buttons">
              <button
                className="pause-menu-confirm-yes"
                onClick={onRestart}
                aria-label="Yes, restart"
              >
                YES
              </button>
              <button
                className="pause-menu-confirm-no"
                onClick={() => setConfirmRestart(false)}
                aria-label="No, cancel"
              >
                NO
              </button>
            </div>
          </div>
        )}

        {showSettings && (
          <div className="pause-menu-settings" role="dialog" aria-label="Settings">
            <h2 className="pause-menu-settings-title">Settings</h2>

            <div className="pause-menu-setting-row">
              <label className="pause-menu-setting-label">Graphics Quality</label>
              <div className="pause-menu-quality-buttons">
                {(Object.keys(QUALITY_LABELS) as QualityPreset[]).map((q) => (
                  <button
                    key={q}
                    className={`pause-menu-quality-btn ${settings.quality === q ? 'active' : ''}`}
                    onClick={() => handleQualityChange(q)}
                    aria-pressed={settings.quality === q}
                  >
                    {QUALITY_LABELS[q]}
                  </button>
                ))}
              </div>
            </div>

            <div className="pause-menu-setting-row">
              <label className="pause-menu-setting-label" htmlFor="pause-volume">
                Sound Volume
              </label>
              <input
                id="pause-volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.soundVolume}
                onChange={(e) => setSettings({ soundVolume: parseFloat(e.target.value) })}
                className="pause-menu-slider"
              />
              <span className="pause-menu-volume-value">
                {Math.round(settings.soundVolume * 100)}%
              </span>
            </div>

            <button
              className="pause-menu-back-btn"
              onClick={() => setShowSettings(false)}
              aria-label="Back to pause menu"
            >
              BACK
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PauseMenu;
