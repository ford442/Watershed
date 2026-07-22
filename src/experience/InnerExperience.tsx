import { PointerLockControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import EnhancedSky from '../components/EnhancedSky';
import FlowForecast from '../components/FlowForecast';
import { PostProcessingPipeline } from '../components/PostProcessingPipeline';
import TrackManager from '../components/TrackManager';
import LevelLoader from '../systems/LevelLoader';
import ReachManager from '../systems/ReachManager';
import { useLOD } from '../systems/LODManager';
import { PHYSICS } from '../constants/game';
import { DAM_RELEASE_SCHEDULE, NOOP_DEBUG } from './constants';
import ExperienceUI from './ExperienceUI';
import HeadlessSkySphere from './HeadlessSkySphere';
import SceneLighting, { isTightCanyonSegment, waterfallFxIntensityForSegment } from './SceneLighting';
import VehicleMount from './VehicleMount';
import PillarDustVFX from '../components/Obstacles/PillarDustVFX';
import PillarFragmentPool from '../components/Obstacles/PillarFragmentPool';
import GhostReplayer from '../components/GhostReplayer';
import { WaterReflectionLayer, WaterPhysicsEffects } from './WaterStack';
import { useInnerExperience } from './hooks/useInnerExperience';
import type { InnerExperienceProps } from './types';

/**
 * InnerExperience — game scene composition (providers are mounted in Experience.tsx).
 */
export default function InnerExperience({
  debug = NOOP_DEBUG,
  physicsDebug = false,
  wireframeDebug = false,
  cleanTest = false,
  mapId,
  onMapChange,
  onReturnToMenu,
}: InnerExperienceProps) {
  const state = useInnerExperience({
    debug,
    physicsDebug,
    cleanTest,
    mapId,
    onMapChange,
    onReturnToMenu,
  });
  const { config: lodConfig, quality: lodQuality } = useLOD();

  const isTightCanyon = isTightCanyonSegment(state.currentSegmentIndex);
  const waterfallFxIntensity = waterfallFxIntensityForSegment(state.currentSegmentIndex);

  return (
    <>
      {state.noPointerLock && <HeadlessSkySphere />}

      {debug.isStageEnabled('visualization') && <EnhancedSky />}

      <SceneLighting
        biome={state.biome}
        currentSegmentIndex={state.currentSegmentIndex}
        playerVelocityRef={state.playerVelocityRef}
        enabled={debug.isStageEnabled('visualization')}
      />

      <WaterReflectionLayer
        enabled={debug.isStageEnabled('worldSystems')}
        enableReflections={lodConfig.enableReflections}
      />

      {debug.isStageEnabled('physics') && (
        <Physics debug={state.isDebug || state.physicsDebugEnabled} gravity={[0, PHYSICS.GRAVITY, 0]}>
          {!state.noPointerLock && (
            <PointerLockControls
              makeDefault
              onLock={() => {}}
              // intentional: R3F PointerLockControls typings omit lockOnClick
              {...({ lockOnClick: true } as object)}
            />
          )}

          <VehicleMount
            vehicleType={state.vehicleType}
            vehicleRef={state.vehicleRef}
            wasmWaterTest={state.wasmWaterTest}
            physicsDebugEnabled={state.physicsDebugEnabled}
            wireframeDebug={wireframeDebug}
            cleanTest={cleanTest}
          />

          <WaterPhysicsEffects
            vehicleRef={state.vehicleRef}
            vehicleType={state.vehicleType}
            enabled={debug.isStageEnabled('worldSystems')}
            flowSpeed={state.biomeMaterials.water.flowSpeed}
            wasmWaterTest={state.wasmWaterTest}
          />

          <PillarFragmentPool castShadow={lodQuality !== 'high'} />
          <PillarDustVFX />
          <GhostReplayer />

          <FlowForecast
            temperature={8}
            snowpackIndex={0.65}
            damReleaseSchedule={DAM_RELEASE_SCHEDULE}
            onForecastChange={state.setForecastSamples}
          />
          {debug.isStageEnabled('dataProcessing') &&
            (state.levelUrl ? (
              <LevelLoader
                levelUrl={state.levelUrl}
                onLoad={state.handleLevelLoad}
                onError={state.handleLevelError}
                showLoader={false}
                showError={false}
                raftRef={state.vehicleRef}
                onBiomeChange={(biome) => state.handleBiomeChange(biome, state.currentSegmentIndex)}
              />
            ) : state.reachId ? (
              <ReachManager
                playerRef={state.vehicleRef}
                onBiomeChange={(biome) => state.handleBiomeChange(biome, state.currentSegmentIndex)}
                forecastSamples={state.forecastSamples}
                reachId={state.reachId}
                onLoadingChange={state.setReachLoading}
                onError={state.setReachError}
                retryKey={state.reachRetryKey}
              />
            ) : (
              <TrackManager
                ref={state.trackManagerRef}
                key={state.defaultMapRunKey}
                onBiomeChange={(biome) => state.handleBiomeChange(biome, state.currentSegmentIndex)}
                raftRef={state.vehicleRef}
                forecastSamples={state.forecastSamples}
                startIndex={state.activeDefaultMap.startIndex}
                mapId={state.activeDefaultMapId}
              />
            ))}
        </Physics>
      )}

      {debug.isStageEnabled('postProcessing') && (
        <PostProcessingPipeline
          quality={state.quality}
          vehicleRef={state.vehicleRef}
          isTightCanyon={isTightCanyon}
          waterfallIntensity={waterfallFxIntensity}
        />
      )}

      <ExperienceUI
        enabled={debug.isStageEnabled('uiOverlay')}
        cleanTest={cleanTest}
        forecastSamples={state.forecastSamples}
        damReleaseSchedule={DAM_RELEASE_SCHEDULE}
        isWipeout={state.isWipeout}
        isJourneyComplete={state.isJourneyComplete}
        onRespawn={state.handleRespawn}
        onRestartJourney={state.handleDefaultJourneyAction}
        onLoopMap={state.handleLoopCurrentMap}
        onContinueJourney={state.canContinueDefaultMap ? state.handleContinueJourney : undefined}
        onReturnToMenu={state.handleReturnToMenu}
        mapLabel={state.activeDefaultMap.label}
        continueLabel={state.continueLabel}
        isFinalMap={state.isFinalMap}
        ghostBestScore={state.ghostBestScore}
        isLoadingLevel={state.isLoadingLevel}
        reachLoading={state.reachLoading}
        levelLoadError={state.levelLoadError}
        onDismissLevelError={() => state.setLevelLoadError(null)}
        onRetryLevel={() => {
          state.setLevelLoadError(null);
          state.setIsLoadingLevel(true);
          state.setLoadedLevelState(null);
        }}
        reachError={state.reachError}
        onRetryReach={() => {
          state.setReachError(null);
          state.setReachRetryKey((k) => k + 1);
        }}
        onDismissReachError={() => state.setReachError(null)}
      />
    </>
  );
}
