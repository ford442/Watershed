/**
 * useMenuFocus.ts — roving-tabindex focus for the DOM menus (#486 B).
 *
 * StartMenu, PauseMenu and the Options panel are navigable without a mouse:
 *
 *   keyboard   ArrowUp/ArrowDown (and ArrowLeft/ArrowRight) move focus through
 *              the menu's controls; Home / End jump to the ends. On a slider,
 *              ArrowLeft/ArrowRight keep adjusting it and only Up/Down move.
 *   gamepad    the d-pad or left stick does the same (they step a focused
 *              slider with Left/Right), A clicks the focused control, B calls
 *              `onBack`, Start calls `onStart`.
 *
 * It is a roving tabindex: exactly one control in the container has
 * `tabindex=0` — the one that last had focus — and the rest are `-1`, so Tab
 * enters and leaves the menu as one stop, and the arrows move within it. The
 * container is rescanned on every key / pad action, so controls that mount
 * later (a confirm dialog, a map list) join without bookkeeping.
 *
 * This file is the hook only. The engine is `input/menuFocusImpl.ts`, fetched
 * when the first menu mounts so the title screen's entry chunk stays small;
 * until it lands the menu behaves as a plain tab-order form.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { lazyModule } from '../utils/lazyModule';
import type { MenuFocusOptions } from '../input/menuFocusImpl';

export type { MenuFocusOptions } from '../input/menuFocusImpl';

const engine = lazyModule(() => import('../input/menuFocusImpl'));

/** Fetch the engine ahead of the first menu (tests, idle preload). */
export function preloadMenuFocus(): Promise<unknown> {
  return engine.load();
}

export function useMenuFocus(containerRef: RefObject<HTMLElement | null>, options: MenuFocusOptions = {}): void {
  const { enabled = true, gamepad = true } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return undefined;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    const attach = (m: typeof import('../input/menuFocusImpl')) => {
      if (!cancelled) dispose = m.attachMenuFocus(container, optionsRef, gamepad);
    };
    const ready = engine.get();
    if (ready) attach(ready);
    else engine.load().then(attach, (err: unknown) => console.warn('[useMenuFocus] engine failed to load:', err));
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [containerRef, enabled, gamepad]);
}
