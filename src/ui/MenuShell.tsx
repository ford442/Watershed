/**
 * MenuShell.tsx — the game-phase overlays over the Canvas, split out of App
 * (#521 C1): the boot loader, Start / Pause menus, the Options panel, and the
 * touch layer. State and transitions live in `useGamePhase`.
 */
import React from 'react';
import { Loader } from '../components/Loader';
import { StartMenu } from '../components/StartMenu';
import { preloadEnvironmentExtras } from '../components/Environment/lazyExtras';
import { isTouchInputMode } from '../input/touchMode';
import { lazyComponent } from '../utils/lazyComponent';
import type { GamePhaseState } from './useGamePhase';
import { useT } from '../i18n/useT';

// Menus and overlays that only mount on a user action or a flag stay out of the entry chunk.
// `preloadOverlays` (idle, once the app is up) fetches the two a player is likely to open, so
// the first PAUSE / OPTIONS click finds them loaded instead of suspending.
const PauseMenuChunk = lazyComponent(() => import('../components/PauseMenu'));
const SettingsPanelChunk = lazyComponent(() => import('./SettingsPanel'));
const PauseMenu = PauseMenuChunk.Component;
const SettingsPanel = SettingsPanelChunk.Component;
// Touch devices only (#486 C): everyone else never fetches the on-screen controls.
const TouchControlsChunk = lazyComponent(() => import('../components/TouchControls'));
const TouchControls = TouchControlsChunk.Component;
// The River Workshop (src/workshop/): one lazy chunk, fetched when the player opens it
// (`workshopMaxBytes` in build-budget.json). Its editor Canvas and drei controls never ride the entry.
const WorkshopChunk = lazyComponent(() => import('../workshop/Workshop'));
const Workshop = WorkshopChunk.Component;
export function preloadOverlays() {
  PauseMenuChunk.preload();
  SettingsPanelChunk.preload();
  if (isTouchInputMode()) TouchControlsChunk.preload();
  // Fauna / biome props / set pieces (Environment/extras.ts) a segment mounts after the menu.
  preloadEnvironmentExtras();
}

const reload = () => window.location.reload();

/** Touch layer (#486 C): only while the run is live. Unmounting it on pause releases every finger. */
export function TouchLayer({ game }: { game: GamePhaseState }) {
  const { phase, worldEnabled } = game;
  const touchMode = isTouchInputMode();
  const t = useT();
  return (
    <>
      {touchMode && phase === 'playing' && worldEnabled && (
        <React.Suspense fallback={null}>
          <TouchControls />
        </React.Suspense>
      )}
      {touchMode && phase === 'playing' && <div className="landscape-hint" role="note">{t('shell.rotate')}</div>}
    </>
  );
}

interface MenuShellProps {
  game: GamePhaseState;
  /** The `uiOverlay` debug stage: off hides every overlay. */
  overlaysEnabled: boolean;
  /** `?no-pointer-lock` harness runs skip the loader. */
  skipLoader: boolean;
  canvasReady: boolean;
  bootReady: boolean;
}

export function MenuShell({ game, overlaysEnabled, skipLoader, canvasReady, bootReady }: MenuShellProps) {
  const { phase, settingsOpen, setSettingsOpen, worldEnabled, workshop } = game;
  const t = useT();
  if (!overlaysEnabled) return null;
  const workshopOpen = workshop.open && phase === 'menu';
  return (
    <>
      {/* Asset loading overlay */}
      {!skipLoader && (
        <Loader gamePhase={phase} canvasReady={canvasReady} worldEnabled={worldEnabled} />
      )}

      {/* Goal 4: Start Menu — shown before first run */}
      {phase === 'menu' && !settingsOpen && !workshopOpen && (
        <StartMenu
          onStart={game.handleStart}
          selectedMapId={game.selectedMapId}
          onSelectMap={game.handleSelectMap}
          onOpenOptions={() => setSettingsOpen(true)}
          onOpenWorkshop={game.openWorkshop}
          onPreloadWorkshop={WorkshopChunk.preload}
          bootReady={bootReady}
        />
      )}
      {/* River Workshop — over the idle menu scene, on its own Canvas */}
      {workshopOpen && (
        <React.Suspense fallback={<div className="workshop-root"><p className="workshop-start">{t('shell.workshopLoading')}</p></div>}>
          <Workshop seed={workshop.seed} onClose={game.closeWorkshop} onTestRun={game.startTestRun} />
        </React.Suspense>
      )}
      {/* Goal 4: Pause Menu — shown when pointer lock is lost during play */}
      {phase === 'paused' && !settingsOpen && (
        <React.Suspense fallback={null}>
          <PauseMenu
            onResume={game.handleResume}
            onRestart={reload}
            onQuit={game.handleQuit}
            onOpenOptions={() => setSettingsOpen(true)}
          />
        </React.Suspense>
      )}
      {/* Options — reachable from StartMenu and PauseMenu. Rendered in the
          unlocked (menu/paused) state so key/mouse capture never fights
          pointer lock. Closing returns to the parent menu; from the pause
          menu that lands on RESUME, which re-locks on the user's click. */}
      {settingsOpen && (phase === 'menu' || phase === 'paused') && (
        <div className="settings-panel-overlay">
          <React.Suspense fallback={null}>
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </React.Suspense>
        </div>
      )}
    </>
  );
}
