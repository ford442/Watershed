// src/components/StartMenu.tsx
// Pre-game title screen with map select, start, and settings

import React, { useMemo, useState } from 'react';
import { useGameStore, type QualityPreset } from '../systems/GameState';
import {
  formatDuration,
  isMapUnlocked,
  listMapsForMenu,
  type MapMenuEntry,
} from '../maps/campaign';
import type { MapRegistryId } from '../maps/registry';
import {
  getBestScoreForMap,
  getCompletedMaps,
  getLastMapId,
} from '../systems/PersistenceSystem';

interface StartMenuProps {
  onStart: (mapId: MapRegistryId) => void;
  selectedMapId: MapRegistryId;
  onSelectMap: (mapId: MapRegistryId) => void;
}

const QUALITY_LABELS: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

const DIFFICULTY_LABELS: Record<MapMenuEntry['difficulty'], string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  expert: 'Expert',
};

/**
 * StartMenu — Title screen that appears before the first run.
 *
 * Features:
 * - Animated title with tagline
 * - Map select from MAP_REGISTRY (URL + last-played parity)
 * - Start button (engages pointer lock)
 * - Settings panel toggle (graphics quality)
 * - Keyboard shortcut: Enter to start
 */
export const StartMenu: React.FC<StartMenuProps> = ({
  onStart,
  selectedMapId,
  onSelectMap,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);

  const completedMaps = useMemo(() => getCompletedMaps(), []);
  const lastMapId = useMemo(() => getLastMapId(), []);
  const maps = useMemo(() => listMapsForMenu(), []);

  const handleQualityChange = (quality: QualityPreset) => {
    setSettings({ quality });
  };

  return (
    <div className="start-menu-overlay">
      <div className="start-menu-card start-menu-card--wide">
        <div className="start-menu-title-group">
          <h1 className="start-menu-title">WATERSHED</h1>
          <p className="start-menu-tagline">
            From alpine source to valley delta — shed the water.
          </p>
        </div>

        {!showSettings ? (
          <div className="start-menu-buttons">
            <div className="start-menu-map-select" role="listbox" aria-label="Select map">
              <div className="start-menu-map-select-label">Choose Map</div>
              {maps.map((map) => {
                const unlocked = isMapUnlocked(map.id, completedMaps);
                const best = getBestScoreForMap(map.id);
                const isSelected = selectedMapId === map.id;
                const isLast = lastMapId === map.id;

                return (
                  <button
                    key={map.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`start-menu-map-option ${isSelected ? 'active' : ''} ${
                      unlocked ? '' : 'soft-locked'
                    }`}
                    onClick={() => onSelectMap(map.id)}
                  >
                    <div className="start-menu-map-option-main">
                      <span className="start-menu-map-option-title">{map.label}</span>
                      <span className="start-menu-map-option-meta">
                        {DIFFICULTY_LABELS[map.difficulty]} · {formatDuration(map.estimatedDurationSec)}
                      </span>
                    </div>
                    <div className="start-menu-map-option-side">
                      {isLast && <span className="start-menu-map-badge">Last</span>}
                      {!unlocked && <span className="start-menu-map-badge muted">Locked</span>}
                      {best > 0 && (
                        <span className="start-menu-map-best">
                          Best {Math.floor(best).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              <p className="start-menu-map-hint">
                Soft-lock marks campaign order — every map stays playable.
              </p>
            </div>

            <button
              className="start-menu-start-btn"
              onClick={() => onStart(selectedMapId)}
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
