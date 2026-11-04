/**
 * useDevToggles.ts — the developer / test-harness switches App threads into the
 * scene, split out of App (#521 C1): clean-test mode, collider draw
 * (`?physicsDebug`), wireframes (`?wireframe`), the SWE bed overlay
 * (`?sweDebug`), and `?no-pointer-lock`'s loader skip.
 *
 * A hook, so it stays in the entry chunk; it is flag reads and a few setters.
 * What drives them under `?debug=1` (DebugPanel, the F/G hotkeys, "Show
 * debug") is `DevOverlays.tsx`, fetched only behind its flags.
 */
import { useEffect, useState } from 'react';
import type { DebugStageController } from '../debug/debugStages';
import { isSWEDebugEnabled } from '../components/sweDebugFlag';
import { isCleanTestMode } from '../utils/cleanTestMode';
import { editQuery, queryFlags } from '../config/queryFlags';

export function useDevToggles(debug: DebugStageController) {
  const [skipLoader, setSkipLoader] = useState(false);
  const [cleanTest, setCleanTest] = useState(() => isCleanTestMode());
  const [physicsDebug, setPhysicsDebug] = useState(() => {
    if (isCleanTestMode()) return false;
    return queryFlags().physicsDebug;
  });
  // #374 Phase 2: false-color view of the sampled SWE bed. URL-only, no
  // DebugPanel toggle — it is a simulation inspector, not a play setting.
  const [sweDebug] = useState(() => !isCleanTestMode() && isSWEDebugEnabled());
  const [wireframeDebug, setWireframeDebug] = useState(() => {
    if (isCleanTestMode()) return false;
    return queryFlags().wireframe;
  });

  const { runStage } = debug;
  useEffect(() => {
    void runStage('appBootstrap', () => {
      if (queryFlags().noPointerLock) {
        setSkipLoader(true);
      }
    });
  }, [runStage]);

  useEffect(() => {
    editQuery((params) => {
      if (physicsDebug) params.set('physicsDebug', '1');
      else params.delete('physicsDebug');
    });
  }, [physicsDebug]);

  useEffect(() => {
    editQuery((params) => {
      if (wireframeDebug) params.set('wireframe', '1');
      else params.delete('wireframe');
    });
  }, [wireframeDebug]);

  useEffect(() => {
    if (!cleanTest) return;
    setPhysicsDebug(false);
    setWireframeDebug(false);
  }, [cleanTest]);

  return {
    skipLoader,
    cleanTest,
    /** Session state only; DevOverlays also persists it (setCleanTestMode). */
    setCleanTest,
    physicsDebug,
    setPhysicsDebug,
    wireframeDebug,
    setWireframeDebug,
    sweDebug,
  };
}

export type DevToggles = ReturnType<typeof useDevToggles>;
