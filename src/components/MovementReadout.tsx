import React, { Suspense, useEffect, useState } from 'react';
import { queryFlags } from '../config/queryFlags';
import { lazyComponent } from '../utils/lazyComponent';

/**
 * Movement verification readout — F3 toggles it, `?debug=1` opens it at boot.
 *
 * Two independent halves, so a tester can tell *where* a failure is:
 *   - INPUT (keys, mouse buttons, mouse delta, pointer lock) comes straight from
 *     window events. If a chip lights when a key is held, the browser is
 *     delivering input to the page.
 *   - MOTION (position, speed, distance) comes from the game store. If the chips
 *     light but POS/SPEED do not change, the player is not responding — and a
 *     POS that drifts with no key down is the river carrying the player.
 *
 * Input is mutated straight into the DOM (no React state per event), and the
 * numeric leaves select formatted strings like the main HUD's readouts do.
 *
 * Only the F3 toggle is in the entry chunk; the panel (MovementReadoutPanel.tsx)
 * loads on first open (#521: a tester's tool, not the player's).
 */

const Panel = lazyComponent(() => import('./MovementReadoutPanel'));

export function isMovementDebugQuery(): boolean {
  return queryFlags().debug;
}

/**
 * The F3 choice outlives this component: the HUD subtree remounts (Canvas
 * remounts, error-boundary resets, map swaps), and a panel that closes itself
 * mid-test is useless. sessionStorage, so it is per tab and never sticks.
 */
export const MOVEMENT_READOUT_KEY = 'watershed:movement-readout';

function readStoredOpen(): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(MOVEMENT_READOUT_KEY);
    return raw === null ? null : raw === '1';
  } catch {
    return null;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    window.sessionStorage.setItem(MOVEMENT_READOUT_KEY, open ? '1' : '0');
  } catch {
    // Storage blocked: the toggle still works for this mount.
  }
}

export const MovementReadout: React.FC = () => {
  const [open, setOpen] = useState(() => readStoredOpen() ?? isMovementDebugQuery());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'F3' || e.repeat) return;
      e.preventDefault(); // F3 is the browser's find-next
      setOpen((prev) => {
        writeStoredOpen(!prev);
        return !prev;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return open ? (
    <Suspense fallback={null}>
      <Panel.Component />
    </Suspense>
  ) : null;
};


export default MovementReadout;
