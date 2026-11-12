// src/components/StartMenu.tsx
// Pre-game title screen with map select, start, and settings

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMenuFocus } from '../hooks/useMenuFocus';
import { useInputStore } from '../input/InputHub';
import {
  getDefaultJourneyStack,
  isMapUnlocked,
  listMapsForMenu,
  type MapMenuEntry,
} from '../maps/campaign';
import type { MapRegistryId } from '../maps/registry';
import { allowedVehiclesForMap } from '../maps/registry';
import type { VehicleType } from '../experience/types';
import { setVehicleChoice } from '../utils/runContext';
import { getMapSurvivalMetadata, mapHasSurvivalFeatures } from '../maps/survivalMetadata';
import {
  getBestScoreForMap,
  getCompletedMaps,
  getLastMapId,
  getLaunchHour,
  getLaunchWeather,
  setLaunchHour,
  setLaunchWeather,
} from '../systems/persistence/PersistenceSystem';
import { DAM_RELEASE_SCHEDULE } from '../experience/constants';
import LaunchHourPicker from './LaunchHourPicker';
import LaunchWeatherPicker from './LaunchWeatherPicker';
import type { WeatherType } from '../constants/weather';
import CachePlacementPanel from './CachePlacementPanel';
import LoadoutPicker from './LoadoutPicker';
import { DEFAULT_MAX_CACHE_PLACEMENTS } from '../systems/survival/portageCache';
import { DEFAULT_LOADOUT_ID, type LoadoutId } from '../systems/survival';
import type { JourneyMode, RunConditions } from '../systems/journey/runSession';
import { lazyComponent } from '../utils/lazyComponent';
import type { UserRiver } from '../systems/map/userRiverSession';
import type { LevelData } from '../systems/map/MapSystem.types';
import { useT } from '../i18n/useT';
import { formatMinutes, formatNumber } from '../i18n/format';
import { mapLabel } from '../i18n/mapLabel';

// Today's River pulls in the day generator; it loads after the menu paints.
const TodaysRiverChunk = lazyComponent(() => import('./TodaysRiverCard'));
// Player rivers carry the level validator; same deal.
const UserRiverChunk = lazyComponent(() => import('./UserRiverPanel'));

interface StartMenuProps {
  onStart: (
    mapId: MapRegistryId,
    options: {
      launchHour: number;
      placedCacheIds: string[];
      loadoutId: LoadoutId;
      journeyMode: 'single' | 'journey';
      /** The picked vehicle; null = "River decides" (the map's own preference). */
      vehicle?: VehicleType | null;
      /** The day's conditions (Today's River); absent = the picked hour and weather. */
      conditions?: Partial<RunConditions>;
      /** A player's river to run over `mapId` (Your Rivers); absent = the campaign map. */
      userRiver?: UserRiver;
    },
  ) => void;
  selectedMapId: MapRegistryId;
  onSelectMap: (mapId: MapRegistryId) => void;
  /** Open the full Options panel (audio, controls/rebinding, graphics). */
  onOpenOptions: () => void;
  /** False while the boot loader is still warming WebGL / preloading assets. */
  bootReady?: boolean;
  /** Open the River Workshop, optionally on a river (a shared link's "Open in Workshop"). */
  onOpenWorkshop?: (seed?: LevelData | null) => void;
  /** Start fetching the Workshop chunk (hover / focus on its button). */
  onPreloadWorkshop?: () => void;
}

/** Vehicle picks; labels are catalog keys, resolved at render. */
const VEHICLE_OPTIONS = [
  { id: null, labelKey: 'menu.vehicle.auto' },
  { id: 'runner', labelKey: 'menu.vehicle.runner' },
  { id: 'raft', labelKey: 'menu.vehicle.raft' },
] as const satisfies ReadonlyArray<{ id: VehicleType | null; labelKey: string }>;

const difficultyKey = (difficulty: MapMenuEntry['difficulty']) => `difficulty.${difficulty}` as const;

/**
 * StartMenu — Title screen that appears before the first run.
 *
 * Features:
 * - Animated title with tagline
 * - Map select from MAP_REGISTRY (URL + last-played parity)
 * - Start button (engages pointer lock)
 * - Settings panel toggle (graphics quality)
 * - Keyboard shortcut: Enter to start
 * - Arrow keys / gamepad d-pad move focus (useMenuFocus); pad Start begins the run
 */
export const StartMenu: React.FC<StartMenuProps> = ({
  onStart,
  selectedMapId,
  onSelectMap,
  onOpenOptions,
  bootReady = true,
  onOpenWorkshop,
  onPreloadWorkshop,
}) => {
  const t = useT();
  const completedMaps = useMemo(() => getCompletedMaps(), []);
  const lastMapId = useMemo(() => getLastMapId(), []);
  const maps = useMemo(() => listMapsForMenu(), []);
  const journeyStack = useMemo(() => getDefaultJourneyStack(), []);
  const [playMode, setPlayMode] = useState<JourneyMode>('single');
  const [launchHour, setLaunchHourLocal] = useState(() => getLaunchHour());
  const [launchWeather, setLaunchWeatherLocal] = useState<WeatherType>(() => getLaunchWeather().type);
  const [placedCacheIds, setPlacedCacheIds] = useState<string[]>([]);
  const [loadoutId, setLoadoutId] = useState<LoadoutId>(DEFAULT_LOADOUT_ID);
  const [vehiclePick, setVehiclePick] = useState<VehicleType | null>(null);

  const effectiveMapId = playMode === 'journey' ? journeyStack[0] ?? 'glacial' : selectedMapId;
  const allowedVehicles = allowedVehiclesForMap(effectiveMapId);
  // A pick the map does not allow falls back to "River decides".
  const vehicle = vehiclePick && allowedVehicles.includes(vehiclePick) ? vehiclePick : null;

  const survivalMeta = useMemo(
    () => getMapSurvivalMetadata(effectiveMapId),
    [effectiveMapId],
  );
  const maxCachePlacements = survivalMeta.maxCachePlacements ?? DEFAULT_MAX_CACHE_PLACEMENTS;
  const showSurvival = mapHasSurvivalFeatures(effectiveMapId);

  // Published as it changes, so a start that bypasses this card (Enter, the
  // Daily River) still runs the picked vehicle.
  useEffect(() => {
    setVehicleChoice(effectiveMapId, vehicle);
  }, [effectiveMapId, vehicle]);

  const handleLaunchHourChange = (hour: number) => {
    setLaunchHourLocal(hour);
    setLaunchHour(hour);
  };

  const handleLaunchWeatherChange = (type: WeatherType) => {
    setLaunchWeatherLocal(type);
    setLaunchWeather(type);
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
    vehicle,
  };

  // Arrow keys and the gamepad d-pad walk the menu; Start (pad) starts the run.
  const cardRef = useRef<HTMLDivElement>(null);
  useMenuFocus(cardRef, {
    onStart: () => {
      if (bootReady) onStart(effectiveMapId, startOptions);
    },
  });
  const usingGamepad = useInputStore((s) => s.activeSourceId === 'gamepad');

  return (
    <div className="start-menu-overlay">
      <div className="start-menu-card start-menu-card--wide" ref={cardRef}>
        <div className="start-menu-title-group">
          <h1 className="start-menu-title">{t('menu.title')}</h1>
          <p className="start-menu-tagline">{t('menu.tagline')}</p>
          {!bootReady && (
            <p className="start-menu-boot-status" role="status" aria-live="polite">
              {t('menu.preparing')}
            </p>
          )}
          {bootReady && (
            <p className="start-menu-boot-status start-menu-boot-status--ready" role="status">
              {t('menu.ready')}
            </p>
          )}
        </div>

        {(
          <div className="start-menu-buttons">
            <Suspense fallback={null}>
              <TodaysRiverChunk.Component
                bootReady={bootReady}
                onStart={(daily) =>
                  onStart(daily.mapId, {
                    launchHour: daily.launchHour,
                    placedCacheIds: [],
                    loadoutId,
                    journeyMode: 'single',
                    conditions: daily.conditions,
                  })
                }
              />
            </Suspense>

            <div className="start-menu-mode-select" role="radiogroup" aria-label={t('menu.playMode.aria')}>
              <div className="start-menu-map-select-label">{t('menu.playMode')}</div>
              <div className="start-menu-mode-row">
                <button
                  type="button"
                  role="radio"
                  aria-checked={playMode === 'single'}
                  className={`start-menu-mode-option ${playMode === 'single' ? 'active' : ''}`}
                  onClick={() => setPlayMode('single')}
                >
                  {t('menu.mode.single')}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={playMode === 'journey'}
                  className={`start-menu-mode-option ${playMode === 'journey' ? 'active' : ''}`}
                  onClick={() => setPlayMode('journey')}
                >
                  {t('menu.mode.journey')}
                </button>
              </div>
              <p className="start-menu-map-hint">
                {playMode === 'journey' ? t('menu.mode.journeyHint') : t('menu.mode.singleHint')}
              </p>
            </div>

            {playMode === 'journey' ? (
              <div className="start-menu-map-select" aria-label={t('menu.journeyRoute.aria')}>
                <div className="start-menu-map-select-label">{t('menu.descentRoute')}</div>
                <ol className="start-menu-journey-stack">
                  {journeyStack.map((id, i) => (
                    <li key={id} className="start-menu-journey-step">
                      <span className="start-menu-journey-index">{i + 1}</span>
                      <span className="start-menu-journey-label">
                        {mapLabel(id)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="start-menu-map-select" role="listbox" aria-label={t('menu.selectMap.aria')}>
                <div className="start-menu-map-select-label">{t('menu.chooseMap')}</div>
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
                        <span className="start-menu-map-option-title">{mapLabel(map.id)}</span>
                        <span className="start-menu-map-option-meta">
                          {t('menu.mapMeta', {
                            difficulty: t(difficultyKey(map.difficulty)),
                            duration: formatMinutes(map.estimatedDurationSec),
                          })}
                        </span>
                      </div>
                      <div className="start-menu-map-option-side">
                        {isLast && <span className="start-menu-map-badge">{t('menu.badge.last')}</span>}
                        {!unlocked && <span className="start-menu-map-badge muted">{t('menu.badge.locked')}</span>}
                        {best > 0 && (
                          <span className="start-menu-map-best">
                            {t('menu.best', { score: formatNumber(Math.floor(best)) })}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                <p className="start-menu-map-hint">
                  {t('menu.softLockHint')}
                </p>
              </div>
            )}

            <div className="start-menu-mode-select" role="radiogroup" aria-label={t('menu.vehicle')}>
              <div className="start-menu-map-select-label">{t('menu.vehicle')}</div>
              {allowedVehicles.length > 1 ? (
                <div className="start-menu-mode-row">
                  {VEHICLE_OPTIONS.map((option) => (
                    <button
                      key={option.id ?? 'river'}
                      type="button"
                      role="radio"
                      aria-checked={vehicle === option.id}
                      className={`start-menu-mode-option ${vehicle === option.id ? 'active' : ''}`}
                      onClick={() => setVehiclePick(option.id)}
                    >
                      {t(option.labelKey)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="start-menu-map-hint">
                  {allowedVehicles[0] === 'raft'
                    ? t('menu.vehicle.onlyRaft', { map: mapLabel(effectiveMapId) })
                    : t('menu.vehicle.onlyRunner', { map: mapLabel(effectiveMapId) })}
                </p>
              )}
            </div>

            <LaunchHourPicker
              value={launchHour}
              onChange={handleLaunchHourChange}
              damReleaseSchedule={DAM_RELEASE_SCHEDULE}
            />

            <LaunchWeatherPicker
              value={launchWeather}
              launchHour={launchHour}
              onChange={handleLaunchWeatherChange}
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
              aria-label={bootReady ? t('menu.start.aria') : t('menu.start.preparingAria')}
              autoFocus
              disabled={!bootReady}
            >
              {bootReady
                ? playMode === 'journey'
                  ? t('menu.start.journey')
                  : t('menu.start.run')
                : t('menu.start.preparing')}
              {bootReady && <span className="start-menu-keyhint">{t('menu.start.keyHint')}</span>}
            </button>

            <Suspense fallback={null}>
              <UserRiverChunk.Component
                bootReady={bootReady}
                onPlay={(userRiver) =>
                  onStart(selectedMapId, {
                    ...startOptions,
                    journeyMode: 'single',
                    // A river allows either vehicle, whatever the backing map forces.
                    vehicle: vehiclePick,
                    userRiver,
                  })
                }
                onOpenInWorkshop={onOpenWorkshop ? (level) => onOpenWorkshop(level) : undefined}
              />
            </Suspense>

            {onOpenWorkshop && (
              <button
                type="button"
                className="start-menu-settings-btn"
                onClick={() => onOpenWorkshop(null)}
                onPointerEnter={onPreloadWorkshop}
                onFocus={onPreloadWorkshop}
                aria-label={t('menu.workshop.aria')}
              >
                {t('menu.workshop')}
              </button>
            )}

            <button
              className="start-menu-settings-btn"
              onClick={onOpenOptions}
              aria-label={t('menu.options.aria')}
            >
              {t('menu.options')}
            </button>
          </div>
        )}

        <div className="start-menu-controls-hint">
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">{t('menu.hint.moveKeys')}</span>
            <span className="start-menu-hint-action">{t('menu.hint.move')}</span>
          </div>
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">{t('menu.hint.mouse')}</span>
            <span className="start-menu-hint-action">{t('menu.hint.look')}</span>
          </div>
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">{t('menu.hint.space')}</span>
            <span className="start-menu-hint-action">{t('menu.hint.jump')}</span>
          </div>
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">{t('menu.hint.esc')}</span>
            <span className="start-menu-hint-action">{t('menu.hint.pause')}</span>
          </div>
          {usingGamepad && (
            <div className="start-menu-hint-row">
              <span className="start-menu-hint-key">{t('menu.hint.padKeys')}</span>
              <span className="start-menu-hint-action">{t('menu.hint.padActions')}</span>
            </div>
          )}
          <div className="start-menu-hint-row">
            <span className="start-menu-hint-key">F3</span>
            <span className="start-menu-hint-action">{t('menu.hint.readout')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
