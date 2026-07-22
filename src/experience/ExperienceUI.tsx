import { Html } from '@react-three/drei';
import GameHUD from '../components/GameHUD';
import ForecastHUD from '../components/ForecastHUD';
import AudioDiagnosticsOverlay from '../components/AudioDiagnosticsOverlay';
import { ErrorDisplay, LoadingDisplay } from '../systems/LevelLoader';
import type { FlowForecastSample } from '../components/FlowForecast';

interface ExperienceUIProps {
  enabled: boolean;
  cleanTest: boolean;
  forecastSamples: FlowForecastSample[];
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
  if (!enabled) return null;

  return (
    <Html fullscreen zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
      {!cleanTest && <ForecastHUD samples={forecastSamples} />}

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
