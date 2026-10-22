/**
 * LevelLoader Component
 * 
 * Runtime level loading system that consumes JSON level data
 * and instantiates the game scene. Integrates with TrackManager
 * and provides loading/error UI.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Html } from '@react-three/drei';
import { useLevel, NormalizedLevelState } from '../hooks/useLevel';
import TrackManager from '../components/TrackManager';
import { ErrorDisplay, LoadingDisplay } from '../systems/map/LevelLoadStatus';

// Props interface
interface LevelLoaderProps {
  /** Level data as JSON object */
  levelData?: any;
  /** URL to load level from */
  levelUrl?: string;
  /** Cache identity for `levelData` (a river's content hash); without it two levels can share a cache slot. */
  levelId?: string;
  /** Callback when level loads successfully */
  onLoad?: (state: NormalizedLevelState) => void;
  /** Callback when loading fails */
  onError?: (error: string) => void;
  /** Whether to show the default loader UI */
  showLoader?: boolean;
  /** Whether to show the default error UI */
  showError?: boolean;
  /** Children components (will be rendered after level loads) */
  children?: React.ReactNode;
  /** Raft/player reference for TrackManager */
  raftRef?: React.RefObject<any>;
  /** Biome change callback */
  onBiomeChange?: (biome: string) => void;
}

/**
 * LevelLoader Component
 *
 * Loads and validates level data, then renders TrackManager.
 */
const LevelLoader: React.FC<LevelLoaderProps> = ({
  levelData,
  levelUrl,
  levelId,
  onLoad,
  onError,
  showLoader = true,
  showError = true,
  children,
  raftRef,
  onBiomeChange,
}) => {
  const {
    loadingState,
    normalizedState,
    levelData: loadedLevelData,
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
        success = await loadFromJSON(levelData, levelId);
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
  }, [levelData, levelUrl, levelId, loadAttempted, loadFromJSON, loadFromURL, normalizedState, error, onLoad, onError]);

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
    return (
      <Html fullscreen zIndexRange={[100, 0]}>
        <LoadingDisplay message="Loading level data..." />
      </Html>
    );
  }

  // Render error state
  if (loadingState === 'error' && error && showError) {
    return (
      <Html fullscreen zIndexRange={[100, 0]}>
        <ErrorDisplay 
          error={error} 
          onRetry={handleRetry}
          onDismiss={handleDismiss}
        />
      </Html>
    );
  }

  // Render loaded level
  if (loadingState === 'loaded' && normalizedState) {
    return (
      <>
        <TrackManager 
          raftRef={raftRef}
          onBiomeChange={onBiomeChange}
          mapData={loadedLevelData}
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
