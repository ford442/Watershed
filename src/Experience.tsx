import { KeyboardControls, Stats } from '@react-three/drei';
import { useEffect } from 'react';
import { BiomeProvider, BiomeTransition } from './systems/BiomeSystem';
import { LODProvider, PerformanceMonitor } from './systems/LODManager';
import { SunPositionProvider } from './systems/lighting/SunPositionSystem';
import PerfCheckpointMonitor from './debug/PerfCheckpointMonitor';
import RendererDiagnosticsMonitor from './rendering/RendererDiagnosticsMonitor';
import BootAssetPreloader from './components/BootAssetPreloader';
import InnerExperience from './experience/InnerExperience';
import { NOOP_DEBUG } from './experience/constants';
import { initShelfLaunchScoringListener } from './systems/score/LaunchScoringSession';
import { initSplitRecordingListener } from './systems/ghost/SplitRecorder';
import { initRunFinishListener } from './systems/ghost/runFinish';
import { loadRivalGhostFromUrl } from './systems/ghost/rivalGhostUrl';
import { getActiveMapId } from './utils/runContext';
import { useSettingsStore } from './systems/settings/useSettingsStore';
import { bindingsToDreiMap } from './systems/settings/settingsDerive';
import type { RendererPreference } from './rendering/types';
import type { ExperienceProps, InnerExperienceProps, VehicleType } from './experience/types';

export type { ExperienceProps, InnerExperienceProps, VehicleType, RendererPreference };

/**
 * Experience — provider shell documented in SYSTEMS.md.
 *
 * Nests LOD → Biome → SunPosition, then mounts InnerExperience for scene graph wiring.
 */
export default function Experience({
  debug = NOOP_DEBUG,
  physicsDebug = false,
  rendererPreference = 'webgl',
  wireframeDebug = false,
  cleanTest = false,
  worldEnabled = true,
  mapId,
  onMapChange,
  onReturnToMenu,
  launchHour,
}: ExperienceProps) {
  const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=true');

  // Rebindable controls: derive drei's KeyboardControls map from the settings
  // store. Changing the reference rebuilds drei's listeners (a brief reset of
  // pressed keys is expected and fine — rebinding happens paused/unlocked).
  const bindings = useSettingsStore((s) => s.bindings);
  const keyboardMap = bindingsToDreiMap(bindings);

  useEffect(() => {
    initShelfLaunchScoringListener();
    initSplitRecordingListener();
    initRunFinishListener();
    void loadRivalGhostFromUrl(getActiveMapId(mapId ?? null));
  }, [mapId]);

  return (
    <>
      {isDebug && <Stats />}
      <BootAssetPreloader />
      <KeyboardControls map={keyboardMap}>
        <LODProvider initialQuality="high" enableAdaptive targetFPS={60}>
          <BiomeProvider initialBiome="canyonSummer" enableTimeOfDay={false}>
            <SunPositionProvider>
              <BiomeTransition />
              <InnerExperience
                debug={debug}
                physicsDebug={physicsDebug}
                wireframeDebug={wireframeDebug}
                cleanTest={cleanTest}
                worldEnabled={worldEnabled}
                mapId={mapId}
                onMapChange={onMapChange}
                onReturnToMenu={onReturnToMenu}
                launchHour={launchHour}
              />
              <PerformanceMonitor visible={import.meta.env.DEV} />
              <RendererDiagnosticsMonitor preference={rendererPreference} />
              {debug.debugEnabled && <PerfCheckpointMonitor />}
            </SunPositionProvider>
          </BiomeProvider>
        </LODProvider>
      </KeyboardControls>
    </>
  );
}
