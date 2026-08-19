// src/components/StartMenu.tsx
// Pre-game title screen with map select, start, and settings

import React, { useEffect, useMemo, useState } from 'react';
import {
  formatDuration,
  getDefaultJourneyStack,
  isMapUnlocked,
  listMapsForMenu,
  type MapMenuEntry,
} from '../maps/campaign';
import type { MapRegistryId } from '../maps/registry';
import { MAP_REGISTRY } from '../maps/registry';
import { getMapSurvivalMetadata, mapHasSurvivalFeatures } from '../maps/survivalMetadata';
import {
  getBestScoreForMap,
  getCompletedMaps,
  getLastMapId,
  getLaunchHour,
  setLaunchHour,
} from '../systems/persistence/PersistenceSystem';
import { DAM_RELEASE_SCHEDULE } from '../experience/constants';
import LaunchHourPicker from './LaunchHourPicker';
import CachePlacementPanel from './CachePlacementPanel';
import LoadoutPicker from './LoadoutPicker';
import { DEFAULT_MAX_CACHE_PLACEMENTS } from '../systems/survival/portageCache';
import { DEFAULT_LOADOUT_ID, type LoadoutId } from '../systems/survival';
import type { JourneyMode } from '../systems/journey/runSession';

interface StartMenuProps {
  onStart: (
    mapId: MapRegistryId,
    options: {
      launchHour: number;
      placedCacheIds: string[];
      loadoutId: LoadoutId;
      journeyMode: 'single' | 'journey';
    },
  ) => void;
  selectedMapId: MapRegistryId;
  onSelectMap: (mapId: MapRegistryId) => void;
  /** Open the full Options panel (audio, controls/rebinding, graphics). */
  onOpenOptions: () => void;
  /** False while the boot loader is still warming WebGL / preloading assets. */
  bootReady?: boolean;
}

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
  onOpenOptions,
  bootReady = true,
}) => {
  const completedMaps = useMemo(() => getCompletedMaps(), []);
  const lastMapId = useMemo(() => getLastMapId(), []);
  const maps = useMemo(() => listMapsForMenu(), []);
  const journeyStack = useMemo(() => getDefaultJourneyStack(), []);
  const [playMode, setPlayMode] = useState<JourneyMode>('single');
  const [launchHour, setLaunchHourLocal] = useState(() => getLaunchHour());
  const [placedCacheIds, setPlacedCacheIds] = useState<string[]>([]);
  const [loadoutId, setLoadoutId] = useState<LoadoutId>(DEFAULT_LOADOUT_ID);

  const effectiveMapId = playMode === 'journey' ? journeyStack[0] ?? 'glacial' : selectedMapId;

  const survivalMeta = useMemo(
    () => getMapSurvivalMetadata(effectiveMapId),
    [effectiveMapId],
  );
  const maxCachePlacements = survivalMeta.maxCachePlacements ?? DEFAULT_MAX_CACHE_PLACEMENTS;
  const showSurvival = mapHasSurvivalFeatures(effectiveMapId);

  const handleLaunchHourChange = (hour: number) => {
    setLaunchHourLocal(hour);
    setLaunchHour(hour);
  };

  const handleCacheToggle = (slotId: string) => {
    setPlacedCacheIds((prev) => {
      if (prev.includes(slotId)) {
        return prev.filter((id) => id !== slotId);
      }
      if (prev.length >= maxCachePlacements) return prev;
      return [...prev, slotId];
    });
  };

  useEffect(() => {
    setPlacedCacheIds([]);
  }, [effectiveMapId]);

  const startOptions = {
    launchHour,
    placedCacheIds,
    loadoutId,
    journeyMode: playMode,
  };

  return (
    <div className="start-menu-overlay">
      <div className="start-menu-card start-menu-card--wide">
        <div className="start-menu-title-group">
          <h1 className="start-menu-title">WATERSHED</h1>
          <p className="start-menu-tagline">
            From alpine source to valley delta — shed the water.
          </p>
          {!bootReady && (
            <p className="start-menu-boot-status" role="status" aria-live="polite">
              Preparing game assets…
            </p>
          )}
          {bootReady && (
            <p className="start-menu-boot-status start-menu-boot-status--ready" role="status">
              Ready — press START RUN or Enter
            </p>
          )}
        </div>

        {(
          <div className="start-menu-buttons">
            <div className="start-menu-mode-select" role="radiogroup" aria-label="Play mode">
              <div className="start-menu-map-select-label">Play Mode</div>
              <div className="start-menu-mode-row">
                <button
                  type="button"
                  role="radio"
                  aria-checked={playMode === 'single'}
                  className={`start-menu-mode-option ${playMode === 'single' ? 'active' : ''}`}
                  onClick={() => setPlayMode('single')}
                >
                  Single Map
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={playMode === 'journey'}
                  className={`start-menu-mode-option ${playMode === 'journey' ? 'active' : ''}`}
                  onClick={() => setPlayMode('journey')}
                >
                  Journey
                </button>
              </div>
              <p className="start-menu-map-hint">
                {playMode === 'journey'
                  ? 'Seamless descent across the unlock graph — survival and score carry at each reach boundary.'
                  : 'Play one authored map. Continue still hands off without remounting the world.'}
              </p>
            </div>

            {playMode === 'journey' ? (
              <div className="start-menu-map-select" aria-label="Journey route">
                <div className="start-menu-map-select-label">Descent Route</div>
                <ol className="start-menu-journey-stack">
                  {journeyStack.map((id, i) => (
                    <li key={id} className="start-menu-journey-step">
                      <span className="start-menu-journey-index">{i + 1}</span>
                      <span className="start-menu-journey-label">
                        {MAP_REGISTRY[id].label}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
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
            )}

            <LaunchHourPicker
              value={launchHour}
              onChange={handleLaunchHourChange}
              damReleaseSchedule={DAM_RELEASE_SCHEDULE}
            />

            <LoadoutPicker selectedId={loadoutId} onSelect={setLoadoutId} />

            {showSurvival && (
              <CachePlacementPanel
                slots={survivalMeta.cacheSlots ?? []}
                selectedIds={placedCacheIds}
                maxPlacements={maxCachePlacements}
                onToggle={handleCacheToggle}
              />
            )}

            <button
              className="start-menu-start-btn"
              onClick={() => onStart(effectiveMapId, startOptions)}
              aria-label={bootReady ? 'Start Game - Click or Press Enter' : 'Preparing game assets'}
              autoFocus
              disabled={!bootReady}
            >
              {bootReady
                ? playMode === 'journey'
                  ? 'START JOURNEY'
                  : 'START RUN'
                : 'PREPARING…'}
              {bootReady && <span className="start-menu-keyhint">ENTER</span>}
            </button>

            <button
              className="start-menu-settings-btn"
              onClick={onOpenOptions}
              aria-label="Open Options"
            >
              OPTIONS
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
