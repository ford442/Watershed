// src/components/PauseMenu.tsx
// Pause overlay with resume, restart, quit, and settings

import React, { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../systems/GameState';

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
  const [confirmRestart, setConfirmRestart] = useState(false);
  const resumeRef = useRef<HTMLButtonElement>(null);

  const ghostEnabled = useGameStore((s) => s.ghostEnabled);
  const setGhostEnabled = useGameStore((s) => s.setGhostEnabled);

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

  return (
    <div className="pause-menu-overlay">
      <div className="pause-menu-card">
        <h1 className="pause-menu-title">PAUSED</h1>

        {!confirmRestart && (
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
              onClick={onOpenOptions}
              aria-label="Open Options"
            >
              OPTIONS
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

      </div>
    </div>
  );
};

export default PauseMenu;
