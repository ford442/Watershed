import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import GameHUD from '../components/GameHUD';
import ForecastHUD from '../components/ForecastHUD';
import AudioDiagnosticsOverlay from '../components/AudioDiagnosticsOverlay';
import GhostTimeDelta from '../components/GhostTimeDelta';
import GhostFairnessBanner from '../components/GhostFairnessBanner';
import { ErrorDisplay, LoadingDisplay } from '../systems/map/LevelLoadStatus';
import type { FlowForecastSample, DamReleaseEntry } from '../components/FlowForecast';
import { useGameStore } from '../systems/GameState';
import { getRunMap } from '../systems/journey/runSession';
import { parseHydroEvents } from '../systems/water/hydroEvents';

/**
 * Pin drei's <Html> to the top-left of the canvas.
 *
 * By default drei translates the Html root to the screen projection of its
 * parent object every frame, so the HUD drifted with the camera (the forecast
 * panel sat ~140 px low), and hid it outright whenever that object was behind
 * the camera. `fullscreen` offsets the wrapper by -size/2, so a root at
 * size/2 puts the wrapper exactly over the canvas.
 */
const screenOrigin = (_obj: unknown, _camera: unknown, size: { width: number; height: number }) => [
  size.width / 2,
  size.height / 2,
];

/** drei's default hides the Html while its parent is behind the camera; a HUD never hides. */
const keepHudVisible = () => {};

/**
 * `transform` on the wrapper makes it the containing block for the HUD's
 * `position: fixed` elements. Without it they anchor to drei's zero-size root
 * and the right- and bottom-anchored ones land mid-screen.
 */
const HUD_WRAPPER_STYLE = { pointerEvents: 'none', transform: 'translateZ(0)' } as const;

interface ExperienceUIProps {
  enabled: boolean;
  cleanTest: boolean;
  forecastSamples: FlowForecastSample[];
  launchHour?: number;
  damReleaseSchedule?: ReadonlyArray<DamReleaseEntry>;
  isWipeout: boolean;
  isJourneyComplete: boolean;
  onRespawn: () => void;
  onRestartJourney: () => void;
  onLoopMap: () => void;
  onContinueJourney?: () => void;
  onReturnToMenu?: () => void;
  mapLabel: string;
  continueLabel?: string;
  isFinalMap?: boolean;
  ghostBestScore?: number;
  isLoadingLevel: boolean;
  reachLoading: boolean;
  levelLoadError: Error | string | null;
  onDismissLevelError: () => void;
  onRetryLevel: () => void;
  reachError: Error | string | null;
  onRetryReach: () => void;
  onDismissReachError: () => void;
}

export default function ExperienceUI({
  enabled,
  cleanTest,
  forecastSamples,
  launchHour,
  damReleaseSchedule = [],
  isWipeout,
  isJourneyComplete,
  onRespawn,
  onRestartJourney,
  onLoopMap,
  onContinueJourney,
  onReturnToMenu,
  mapLabel,
  continueLabel,
  isFinalMap = false,
  ghostBestScore = 0,
  isLoadingLevel,
  reachLoading,
  levelLoadError,
  onDismissLevelError,
  onRetryLevel,
  reachError,
  onRetryReach,
  onDismissReachError,
}: ExperienceUIProps) {
  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  // Authored hydro events for the active map — the HUD contrasts the run's
  // launch hour against the other scouting hour (#397).
  const hydroEvents = useMemo(() => {
    try {
      return parseHydroEvents(getRunMap().levelData.hydroEvents);
    } catch {
      return [];
    }
  }, [mapLabel]);
  const lastSplitDelta = useGameStore((s) => s.lastSplitDelta);

  if (!enabled) return null;

  return (
    <Html
      fullscreen
      zIndexRange={[100, 0]}
      calculatePosition={screenOrigin}
      onOcclude={keepHudVisible}
      style={HUD_WRAPPER_STYLE}
    >
      {!cleanTest && (
        <ForecastHUD
          samples={forecastSamples}
          launchHour={launchHour}
          damReleaseSchedule={damReleaseSchedule}
          currentSegmentIndex={currentSegmentIndex}
          hydroEvents={hydroEvents}
        />
      )}

      <div style={{ pointerEvents: isWipeout || isJourneyComplete ? 'auto' : 'none' }}>
        <GameHUD
          isWipeout={isWipeout}
          onRespawn={onRespawn}
          onRestartJourney={onRestartJourney}
          onLoopMap={onLoopMap}
          onContinueJourney={onContinueJourney}
          onReturnToMenu={onReturnToMenu}
          mapLabel={mapLabel}
          continueLabel={continueLabel}
          isFinalMap={isFinalMap}
          ghostBestScore={ghostBestScore}
        />
      </div>

      {!cleanTest && !isWipeout && !isJourneyComplete && <GhostFairnessBanner mapLabel={mapLabel} />}

      {!cleanTest && lastSplitDelta && (
        <GhostTimeDelta key={lastSplitDelta.id} deltaSeconds={lastSplitDelta.deltaSeconds} />
      )}

      {isLoadingLevel && <LoadingDisplay message="Loading custom level..." />}
      {reachLoading && <LoadingDisplay message="Loading Reach..." />}

      {levelLoadError && (
        <div style={{ pointerEvents: 'auto' }}>
          <ErrorDisplay
            error={typeof levelLoadError === 'string' ? levelLoadError : levelLoadError.message}
            onDismiss={onDismissLevelError}
            onRetry={onRetryLevel}
          />
        </div>
      )}

      {import.meta.env.DEV && !cleanTest && <AudioDiagnosticsOverlay />}

      {reachError && (
        <div
          style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(40, 40, 40, 0.9)',
            color: '#ffcc00',
            padding: '10px 18px',
            borderRadius: '6px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '14px',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            pointerEvents: 'auto',
          }}
        >
          <span>⚠ Reach unavailable — playing procedural track</span>
          <button
            type="button"
            onClick={onRetryReach}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onDismissReachError}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#aaa',
              cursor: 'pointer',
              fontSize: '16px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
    </Html>
  );
}
