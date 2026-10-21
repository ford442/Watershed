// src/hooks/useNightMode.ts
// Global night mode state with keyboard toggle

import { useState, useEffect, useCallback } from 'react';
import { NIGHT_MODE } from '../constants/nightMode';
import { parseDebugEnabled } from '../debug/debugStages';

export interface NightModeState {
  /** Whether night mode is active */
  isNight: boolean;
  /** Toggle night mode */
  toggle: () => void;
  /** Set night mode explicitly */
  setIsNight: (value: boolean) => void;
}

/**
 * useNightMode — Global night mode toggle with 'N' key
 * 
 * Usage:
 * const { isNight, toggle } = useNightMode();
 * 
 * Press 'N' to toggle day/night — only under `?debug=1`; production never binds it (#486 B).
 */
export const useNightMode = (): NightModeState => {
  const [isNight, setIsNight] = useState(NIGHT_MODE.enabled);

  const toggle = useCallback(() => {
    setIsNight(prev => {
      const next = !prev;
      console.log(`[NightMode] ${next ? '🌙 Night' : '☀️ Day'} mode`);
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

export default useNightMode;
