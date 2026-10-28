/**
 * App.tsx — composition only (#521 C1). The parts:
 *
 *   boot/     useRendererBoot + RendererBoot — graphics negotiation, the boot
 *             crash guard, the Canvas and its renderer notices
 *   ui/       useGamePhase + MenuShell — menu / playing / paused and the
 *             overlays that show it
 *   harness/  dev and test switches (`?debug`, `?cleanTest`, `?replay`,
 *             `?river`, `?editor`, …) — their overlays fetched behind the flags
 *
 * Every hook runs before the unsupported-tier and editor branches, so their
 * effects (persistence, settings rehydration, the boot clamps) run on every
 * page, as they always have.
 */
import React, { useEffect } from 'react';
import Experience from './Experience';
import ErrorBoundary from './components/ErrorBoundary';
import GraphicsUnsupported from './components/GraphicsUnsupported';
import { SettingsSync } from './ui/SettingsSync';
import { useDebugStages } from './debug/debugStages';
import { whenIdle } from './utils/whenIdle';
import { lazyComponent } from './utils/lazyComponent';
import { RendererBoot, RendererBootNotices } from './boot/RendererBoot';
import { useRendererBoot, type GraphicsBoot } from './boot/useRendererBoot';
import { MenuShell, TouchLayer, preloadOverlays } from './ui/MenuShell';
import { useGamePhase } from './ui/useGamePhase';
import { useDevToggles } from './harness/useDevToggles';
import { useHarnessAutostart } from './harness/useHarnessAutostart';
import { EditorHarness, isEditorMode } from './harness/EditorHarness';
import './style.css';

export type { GraphicsBoot } from './boot/useRendererBoot';

// `?debug=1` / `?sweDebug=1` only (#485 C): a player never fetches the inspector.
const DevOverlays = lazyComponent(() => import('./harness/DevOverlays')).Component;

export interface AppProps {
  /** Test seam: pre-negotiated graphics boot. Production negotiates its own. */
  graphicsBoot?: GraphicsBoot;
}

function App({ graphicsBoot }: AppProps = {}) {
  const debug = useDebugStages();
  useEffect(() => whenIdle(preloadOverlays), []);
  // Boot first: its quality clamps run before the session rehydrates settings.
  const boot = useRendererBoot(graphicsBoot);
  const game = useGamePhase(debug, boot.bootReady);
  const dev = useDevToggles(debug);
  useHarnessAutostart(game.handleStart, game.selectedMapId, boot.bootReady);

  // No WebGL2 by any attempt: render static DOM and mount nothing. R3F, Rapier's
  // WASM world, the treadmill, and audio all assume a renderer exists, and
  // starting them anyway is what produced the infinite loader.
  if (boot.capability.tier === 'unsupported') {
    return (
      <ErrorBoundary>
        <GraphicsUnsupported
          statusMessage={boot.capability.statusMessage}
          attributesRejected={boot.capability.reason === 'attributes-rejected'}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      {/* Editor mode: full-page swap, own Canvas, own lifecycle */}
      {isEditorMode ? (
        <EditorHarness />
      ) : (
        <>
          <SettingsSync />
          <RendererBoot boot={boot} onCreated={() => debug.runStage('visualization', () => undefined)}>
            <Experience
              debug={debug}
              physicsDebug={dev.physicsDebug}
              rendererPreference={boot.rendererPreference}
              wireframeDebug={dev.wireframeDebug}
              cleanTest={dev.cleanTest}
              worldEnabled={game.worldEnabled}
              mapId={game.selectedMapId}
              onMapChange={game.handleSelectMap}
              onReturnToMenu={game.handleReturnToMenu}
              launchHour={game.activeLaunchHour}
            />
          </RendererBoot>
          <TouchLayer game={game} />
          <RendererBootNotices boot={boot} cleanTest={dev.cleanTest} />
          <MenuShell
            game={game}
            overlaysEnabled={debug.isStageEnabled('uiOverlay')}
            skipLoader={dev.skipLoader}
            canvasReady={boot.canvasReady}
            bootReady={boot.bootReady}
          />
          {(dev.sweDebug || debug.debugEnabled) && (
            <React.Suspense fallback={null}>
              <DevOverlays debug={debug} dev={dev} boot={boot} />
            </React.Suspense>
          )}
        </>
      )}
    </ErrorBoundary>
  );
}

export default App;
