// src/hooks/useNightMode.ts
// Global night mode state with keyboard toggle

import { useState, useEffect, useCallback } from 'react';
import { NIGHT_MODE } from '../constants/nightMode';
import { parseDebugEnabled } from '../debug/debugStages';
import { getSkyPhase, subscribeSkyPhase } from '../systems/sky/skyClock';

export interface NightModeState {
  /** Whether night mode is active */
  isNight: boolean;
  /** Toggle night mode */
  toggle: () => void;
  /** Set night mode explicitly */
  setIsNight: (value: boolean) => void;
}

/**
 * useNightMode — is it night? The hour says so (the run's sky clock: the sun
 * 8° below the horizon or lower); the debug toggle flips that.
 *
 * Usage:
 * const { isNight, toggle } = useNightMode();
 *
 * Press 'N' to flip day/night — only under `?debug=1`; production never binds it (#486 B).
 */
export const useNightMode = (): NightModeState => {
  const [skyNight, setSkyNight] = useState(() => getSkyPhase().isNight);
  const [flipped, setFlipped] = useState(NIGHT_MODE.enabled);

  useEffect(() => subscribeSkyPhase((phase) => setSkyNight(phase.isNight)), []);

  const isNight = skyNight !== flipped;
  const setIsNight = useCallback((value: boolean) => setFlipped(value !== getSkyPhase().isNight), []);

  const toggle = useCallback(() => {
    setFlipped((prev) => {
      const next = !prev;
      console.log(`[NightMode] ${next !== getSkyPhase().isNight ? '🌙 Night' : '☀️ Day'} mode`);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!parseDebugEnabled()) return undefined;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === NIGHT_MODE.toggleKey) {
        toggle();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggle]);

  return { isNight, toggle, setIsNight };
};
