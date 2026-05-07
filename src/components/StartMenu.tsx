// src/components/StartMenu.tsx
// Pre-game title screen with start and settings

import React, { useState } from 'react';
import { useGameStore, type QualityPreset } from '../systems/GameState';

interface StartMenuProps {
  onStart: () => void;
}

const QUALITY_LABELS: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

/**
 * StartMenu — Title screen that appears before the first run.
 *
 * Features:
 * - Animated title with tagline
 * - Start button (engages pointer lock)
 * - Settings panel toggle (graphics quality)
 * - Keyboard shortcut: Enter to start
 */
export const StartMenu: React.FC<StartMenuProps> = ({ onStart }) => {
  const [showSettings, setShowSettings] = useState(false);
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);

  const handleQualityChange = (quality: QualityPreset) => {
    setSettings({ quality });
  };

  return (
    <div className="start-menu-overlay">
      <div className="start-menu-card">
        {/* Title */}
        <div className="start-menu-title-group">
          <h1 className="start-menu-title">WATERSHED</h1>
          <p className="start-menu-tagline">
            From alpine source to valley delta — shed the water.
          </p>
        </div>

        {/* Buttons */}
        {!showSettings ? (
          <div className="start-menu-buttons">
            <button
              className="start-menu-start-btn"
              onClick={onStart}
              aria-label="Start Game - Click or Press Enter"
              autoFocus
            >
              START RUN
              <span className="start-menu-keyhint">ENTER</span>
            </button>

            <button
              className="start-menu-settings-btn"
              onClick={() => setShowSettings(true)}
              aria-label="Open Settings"
            >
              SETTINGS
            </button>
          </div>
        ) : (
          <div className="start-menu-settings" role="dialog" aria-label="Settings">
            <h2 className="start-menu-settings-title">Settings</h2>

            {/* Graphics Quality */}
            <div className="start-menu-setting-row">
              <label className="start-menu-setting-label">Graphics Quality</label>
              <div className="start-menu-quality-buttons">
                {(Object.keys(QUALITY_LABELS) as QualityPreset[]).map((q) => (
                  <button
                    key={q}
                    className={`start-menu-quality-btn ${settings.quality === q ? 'active' : ''}`}
                    onClick={() => handleQualityChange(q)}
                    aria-pressed={settings.quality === q}
                  >
                    {QUALITY_LABELS[q]}
                  </button>
                ))}
              </div>
            </div>

            {/* Sound Volume */}
            <div className="start-menu-setting-row">
              <label className="start-menu-setting-label" htmlFor="volume-slider">
                Sound Volume
              </label>
              <input
                id="volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.soundVolume}
                onChange={(e) => setSettings({ soundVolume: parseFloat(e.target.value) })}
                className="start-menu-slider"
                aria-label="Sound volume"
              />
              <span className="start-menu-volume-value">
                {Math.round(settings.soundVolume * 100)}%
              </span>
            </div>

            <button
              className="start-menu-back-btn"
              onClick={() => setShowSettings(false)}
              aria-label="Back to main menu"
            >
              BACK
            </button>
          </div>
        )}

        {/* Controls hint */}
        <div className="start-menu-controls-hint">
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">WASD</span>
            <span className="start-menu-hint-action">Move</span>
          </div>
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">Mouse</span>
            <span className="start-menu-hint-action">Look</span>
          </div>
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">Space</span>
            <span className="start-menu-hint-action">Jump</span>
          </div>
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">Esc</span>
            <span className="start-menu-hint-action">Pause</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StartMenu;
