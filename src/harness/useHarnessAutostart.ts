/**
 * useHarnessAutostart.ts — runs that start themselves once boot is ready,
 * skipping the menu, split out of App (#521 C1): `?replay=<ghost>` (the replay
 * smoke, shared ghosts) and `?river=<id>` (the level editor's Play).
 *
 * Only the flag check lives in the entry chunk; what each run does is
 * `autostartRun.ts`, fetched behind its flag.
 */
import { useEffect, useRef } from 'react';
import type { MapRegistryId } from '../maps/registry';
import { getReplayGhostUrl } from '../input/scriptedRun';
import { queryFlags } from '../config/queryFlags';
import type { StartRun } from '../ui/useGamePhase';

export function useHarnessAutostart(handleStart: StartRun, selectedMapId: MapRegistryId, bootReady: boolean): void {
  // The run loads asynchronously; it starts with whatever handleStart is
  // current then (it is rebuilt as the menu state settles).
  const startedRef = useRef(false);
  const handleStartRef = useRef(handleStart);
  const selectedMapIdRef = useRef(selectedMapId);
  useEffect(() => {
    handleStartRef.current = handleStart;
    selectedMapIdRef.current = selectedMapId;
  }, [handleStart, selectedMapId]);
  useEffect(() => {
    const replayUrl = getReplayGhostUrl();
    const riverId = queryFlags().river;
    if ((!replayUrl && !riverId) || !bootReady || startedRef.current) return;
    startedRef.current = true;
    void import('./autostartRun').then(({ autostartRun }) =>
      autostartRun({
        replayUrl,
        riverId,
        start: (mapId, options) => handleStartRef.current(mapId, options),
        selectedMapId: () => selectedMapIdRef.current,
      }),
    );
  }, [bootReady]);
}
