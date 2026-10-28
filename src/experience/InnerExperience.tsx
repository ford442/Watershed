import { lazy, Suspense } from 'react';
import { PointerLockControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import EnhancedSky from '../components/EnhancedSky';
import FlowForecast from '../components/FlowForecast';
import { PostProcessingPipeline } from '../components/PostProcessingPipeline';
import TrackManager from '../components/TrackManager';
import SpeedWindAudio from '../components/SpeedWindAudio';
import { useLOD } from '../systems/lod/LODManager';
import { PHYSICS } from '../constants/game';
import { DAM_RELEASE_SCHEDULE, NOOP_DEBUG } from './constants';
import ExperienceUI from './ExperienceUI';
import HeadlessSkySphere from './HeadlessSkySphere';
import SceneLighting, { isTightCanyonSegment, waterfallFxIntensityForSegment } from './SceneLighting';
import VehicleMount from './VehicleMount';
import PillarDustVFX from '../components/Obstacles/PillarDustVFX';
import WindLeaves from '../components/Environment/WindLeaves';
import SurvivalMarkers from '../components/Survival/SurvivalMarkers';
import PillarFragmentPool from '../components/Obstacles/PillarFragmentPool';
import GhostReplayer from '../components/GhostReplayer';
import { WaterReflectionLayer, WaterPhysicsEffects } from './WaterStack';
import SettingsLookSync from '../ui/SettingsLookSync';
import { isCleanTestMode } from '../utils/cleanTestMode';
import { useInnerExperience } from './hooks/useInnerExperience';
import WeatherSystem from '../components/WeatherSystem';
import { getActiveConditions } from '../systems/journey/runSession';
import { weatherScriptHasWeather } from '../systems/weather/weatherScript';
import { WeatherDirectorTick } from '../systems/weather/WeatherDirectorTick';
import { SkyClockTick } from '../systems/sky/SkyClockTick';
import { SimCoreTick } from './SimCoreTick';
import type { InnerExperienceProps } from './types';
import { InputHubTick } from '../input/InputHubTick';
import { isTouchInputMode } from '../input/touchMode';
import { isScriptedRunLive } from '../input/scriptedRun';

// #485 C: step-time instrumentation for the DebugPanel and `pnpm profile:physics`
// (which runs with ?cleanTest=1, never ?debug=1) — not part of play, so not in the entry.
const PhysicsPerfMonitor = lazy(() => import('../debug/PhysicsPerfMonitor'));

// Map sources behind a URL flag: `?level=` (LevelLoader — a player's river from the StartMenu
// takes the same path) and `?reach=` (ReachManager + the Reach
// streamer, reactive audio and manifest normalizer). The campaign default mounts neither, so
// their code loads only for the session that asks. Suspense stays local: the vehicle, water and
// HUD keep running while the chunk lands.
const LevelLoader = lazy(() => import('./LevelLoader'));
const ReachManager = lazy(() => import('./ReachManager'));

/**
 * InnerExperience — game scene composition (providers are mounted in Experience.tsx).
 */
export default function InnerExperience({
  debug = NOOP_DEBUG,
  physicsDebug = false,
  wireframeDebug = false,
  cleanTest = false,
  worldEnabled = true,
  mapId,
  onMapChange,
  onReturnToMenu,
  launchHour,
}: InnerExperienceProps) {
  const state = useInnerExperience({
    debug,
    physicsDebug,
    cleanTest,
    mapId,
    onMapChange,
    onReturnToMenu,
    launchHour,
  });
  const { config: lodConfig, quality: lodQuality } = useLOD();

  // The day's conditions are fixed at launch with the hour; the director steps the weather script.
  const conditions = getActiveConditions();
  const scriptHasWeather = weatherScriptHasWeather(conditions.weatherScript);
  const isTightCanyon = isTightCanyonSegment(state.currentSegmentIndex);
  const waterfallFxIntensity = waterfallFxIntensityForSegment(state.currentSegmentIndex);

  return (
    <>
      {state.noPointerLock && <HeadlessSkySphere />}

      {debug.isStageEnabled('visualization') && <EnhancedSky />}

      {/* The fixed-step gameplay clock (−90): weather, sky clock, biome detection, survival, pillars, scoring. */}
      <SimCoreTick debug={debug} vehicleRef={state.vehicleRef} />
      {/* Keeps the weather director's ambient in step with the biome (SimCore steps the director). */}
      <WeatherDirectorTick />
      {/* Places the sun for the sky clock SimCore advances, for every reader below. */}
      <SkyClockTick />

      <SceneLighting
        biome={state.biome}
        currentSegmentIndex={state.currentSegmentIndex}
        playerVelocityRef={state.playerVelocityRef}
        enabled={debug.isStageEnabled('visualization')}
      />

      {worldEnabled && (
        <WaterReflectionLayer
          enabled={debug.isStageEnabled('worldSystems')}
          enableReflections={lodConfig.enableReflections}
        />
      )}

      {worldEnabled && debug.isStageEnabled('physics') && (
        <Physics debug={state.isDebug || state.physicsDebugEnabled} gravity={[0, PHYSICS.GRAVITY, 0]}>
          {(debug.debugEnabled || isCleanTestMode()) && (
            <Suspense fallback={null}>
              <PhysicsPerfMonitor />
            </Suspense>
          )}
          {/* Ticks the input hub at priority −100, ahead of the vehicle step. */}
          <InputHubTick isRunLive={() => isScriptedRunLive(state.vehicleRef.current)} />
          {!state.noPointerLock && !isTouchInputMode() && (
            <>
              <PointerLockControls makeDefault onLock={() => {}} {...({ lockOnClick: true } as object)} />
              <SettingsLookSync />
            </>
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

          {/* Spatial portage / cache markers for the active map (survival v2). */}
          <SurvivalMarkers vehicleRef={state.vehicleRef} />

          <PillarFragmentPool castShadow={lodQuality !== 'high'} />
          <PillarDustVFX />
          <WindLeaves />
          <GhostReplayer />

          <FlowForecast
            temperature={conditions.temperature}
            snowpackIndex={conditions.snowpackIndex}
            damReleaseSchedule={DAM_RELEASE_SCHEDULE}
            startHour={state.launchHour}
            onForecastChange={state.setForecastSamples}
          />
          {debug.isStageEnabled('dataProcessing') &&
            (state.levelUrl ? (
              <Suspense fallback={null}>
                <LevelLoader
                  levelUrl={state.levelUrl}
                  onLoad={state.handleLevelLoad}
                  onError={state.handleLevelError}
                  showLoader={false}
                  showError={false}
                  raftRef={state.vehicleRef}
                  onBiomeChange={state.handleBiomeChange}
                />
              </Suspense>
            ) : state.userRiver ? (
              <Suspense fallback={null}>
                <LevelLoader
                  key={state.userRiver.hash}
                  levelData={state.userRiver.level}
                  levelId={`river-${state.userRiver.hash}`}
                  onLoad={state.handleLevelLoad}
                  onError={state.handleLevelError}
                  showLoader={false}
                  showError={false}
                  raftRef={state.vehicleRef}
                  onBiomeChange={state.handleBiomeChange}
                />
              </Suspense>
            ) : state.reachId ? (
              <Suspense fallback={null}>
                <ReachManager
                  playerRef={state.vehicleRef}
                  onBiomeChange={state.handleBiomeChange}
                  forecastSamples={state.forecastSamples}
                  reachId={state.reachId}
                  onLoadingChange={state.setReachLoading}
                  onError={state.setReachError}
                  retryKey={state.reachRetryKey}
                />
              </Suspense>
            ) : (
              <>
                <TrackManager
                  ref={state.trackManagerRef}
                  key={state.defaultMapRunKey}
                  onBiomeChange={state.handleBiomeChange}
                  raftRef={state.vehicleRef}
                  forecastSamples={state.forecastSamples}
                  startIndex={state.activeDefaultMap.startIndex}
                  mapId={state.activeDefaultMapId}
                  seamlessJourney={state.seamlessJourney}
                  onSeamlessHandoff={state.handleSeamlessHandoffFromTrack}
                />
                {/* Speed wind for default (non-Reach) maps — Reach path gets it via ReactiveAudio. */}
                <SpeedWindAudio targetRef={state.vehicleRef} />
                {/* The run's weather on the campaign maps (#464). An all-clear script
                    mounts nothing, so a clear run's lighting and fog are untouched. */}
                {scriptHasWeather && <WeatherSystem targetRef={state.vehicleRef} />}
              </>
            ))}
        </Physics>
      )}

      {worldEnabled && debug.isStageEnabled('postProcessing') && (
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
        launchHour={state.launchHour}
        damReleaseSchedule={DAM_RELEASE_SCHEDULE}
        isWipeout={state.isWipeout}
        isJourneyComplete={state.isJourneyComplete}
        onRespawn={state.handleRespawn}
        onRestartJourney={state.handleDefaultJourneyAction}
        onLoopMap={state.handleLoopCurrentMap}
        onContinueJourney={state.canContinueDefaultMap ? state.handleContinueJourney : undefined}
        onReturnToMenu={state.handleReturnToMenu}
        mapLabel={state.userRiver?.label ?? state.activeDefaultMap.label}
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
