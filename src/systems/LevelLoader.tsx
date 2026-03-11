/**
 * LevelLoader Component
 * 
 * Runtime level loading system that consumes JSON level data
 * and instantiates the game scene. Integrates with TrackManager
 * and provides loading/error UI.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useLevel, NormalizedLevelState } from '../hooks/useLevel';
import TrackManager from '../components/TrackManager';
import RiverTrack from '../components/RiverTrack';
import { Loader } from '../components/Loader';

// Props interface
interface LevelLoaderProps {
  /** Level data as JSON object */
  levelData?: any;
  /** URL to load level from */
  levelUrl?: string;
  /** Callback when level loads successfully */
  onLoad?: (state: NormalizedLevelState) => void;
  /** Callback when loading fails */
  onError?: (error: string) => void;
  /** Whether to show the default loader UI */
  showLoader?: boolean;
  /** Whether to use legacy RiverTrack (default: false) */
  useLegacyTrack?: boolean;
  /** Children components (will be rendered after level loads) */
  children?: React.ReactNode;
  /** Raft/player reference for TrackManager */
  raftRef?: React.RefObject<any>;
  /** Biome change callback */
  onBiomeChange?: (biome: string) => void;
}

// Error display component
const ErrorDisplay: React.FC<{ 
  error: string; 
  onRetry?: () => void;
  onDismiss?: () => void;
}> = ({ error, onRetry, onDismiss }) => (
  <div style={{
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(180, 40, 40, 0.95)',
    color: 'white',
    padding: '24px 32px',
    borderRadius: '8px',
    maxWidth: '500px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    zIndex: 10000,
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  }}>
    <h3 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>⚠ Level Load Error</h3>
    <pre style={{ 
      margin: '0 0 16px 0', 
      whiteSpace: 'pre-wrap',
      fontSize: '13px',
      lineHeight: 1.5,
      opacity: 0.9,
    }}>{error}</pre>
    <div style={{ display: 'flex', gap: '12px' }}>
      {onRetry && (
        <button 
          onClick={onRetry}
          style={{
            padding: '8px 16px',
            background: 'white',
            color: '#b42828',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          Retry
        </button>
      )}
      {onDismiss && (
        <button 
          onClick={onDismiss}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            color: 'white',
            border: '1px solid white',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  </div>
);

// Loading display component
const LoadingDisplay: React.FC<{ 
  message?: string;
  progress?: number;
}> = ({ message = 'Loading level...', progress }) => (
  <div style={{
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0, 0, 0, 0.85)',
    color: 'white',
    padding: '24px 32px',
    borderRadius: '8px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    zIndex: 10000,
    textAlign: 'center',
  }}>
    <div style={{ 
      width: '40px', 
      height: '40px', 
      border: '3px solid rgba(255,255,255,0.2)',
      borderTop: '3px solid white',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      margin: '0 auto 16px',
    }} />
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
    <p style={{ margin: 0, fontSize: '14px' }}>{message}</p>
    {progress !== undefined && (
      <div style={{
        width: '200px',
        height: '4px',
        background: 'rgba(255,255,255,0.2)',
        borderRadius: '2px',
        marginTop: '12px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'white',
          transition: 'width 0.3s ease',
        }} />
      </div>
    )}
  </div>
);

/**
 * LevelLoader Component
 * 
 * Loads and validates level data, then renders the appropriate
 * track system (TrackManager for dynamic levels, RiverTrack for legacy).
 */
const LevelLoader: React.FC<LevelLoaderProps> = ({
  levelData,
  levelUrl,
  onLoad,
  onError,
  showLoader = true,
  useLegacyTrack = false,
  children,
  raftRef,
  onBiomeChange,
}) => {
  const {
    loadingState,
    normalizedState,
    error,
    loadFromJSON,
    loadFromURL,
    reloadCurrent,
    clearLevel,
  } = useLevel();

  const [loadAttempted, setLoadAttempted] = useState(false);

  // Load level when props change
  useEffect(() => {
    if (loadAttempted) return;

    const load = async () => {
      setLoadAttempted(true);
      
      let success = false;
      
      if (levelData) {
        success = await loadFromJSON(levelData);
      } else if (levelUrl) {
        success = await loadFromURL(levelUrl);
      }

      if (success && normalizedState) {
        onLoad?.(normalizedState);
      } else if (error) {
        onError?.(error);
      }
    };

    if (levelData || levelUrl) {
      load();
    }
  }, [levelData, levelUrl, loadAttempted, loadFromJSON, loadFromURL, normalizedState, error, onLoad, onError]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setLoadAttempted(false);
    reloadCurrent();
  }, [reloadCurrent]);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    clearLevel();
    onError?.('Level load dismissed');
  }, [clearLevel, onError]);

  // Render loading state
  if (loadingState === 'loading' && showLoader) {
    return <LoadingDisplay message="Loading level data..." />;
  }

  // Render error state
  if (loadingState === 'error' && error) {
    return (
      <ErrorDisplay 
        error={error} 
        onRetry={handleRetry}
        onDismiss={handleDismiss}
      />
    );
  }

  // Render legacy track if requested
  if (useLegacyTrack) {
    return (
      <>
        <RiverTrack />
        {children}
      </>
    );
  }

  // Render loaded level
  if (loadingState === 'loaded' && normalizedState) {
    return (
      <>
        <TrackManager 
          raftRef={raftRef}
          onBiomeChange={onBiomeChange}
          levelState={normalizedState}
        />
        {children}
      </>
    );
  }

  // Default: nothing to render
  return null;
};

export default LevelLoader;
export { ErrorDisplay, LoadingDisplay };
