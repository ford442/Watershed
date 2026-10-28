/**
 * menuFocusImpl.ts — the roving-tabindex focus engine behind `useMenuFocus` (#486 B).
 *
 * Fetched when the first menu mounts (see `useMenuFocus.ts`), so the title
 * screen's entry chunk carries only the thin hook.
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
 */

import type { RefObject } from 'react';
import {
  createMenuNavState,
  firstStandardPad,
  stepMenuNav,
  type MenuAction,
} from './menuNav';
import type { PadLike } from './sources/gamepadMapping';

const FOCUSABLE =
  'button:not([disabled]), [role="option"]:not([aria-disabled="true"]), [role="radio"]:not([disabled]), input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled]), a[href]';

export interface MenuFocusOptions {
  /** Turn the hook off (the Options panel passes `!capturing` so a rebind keypress is not navigation). */
  enabled?: boolean;
  /** B on a gamepad (the keyboard's Escape is owned by each menu). */
  onBack?: () => void;
  /** Start on a gamepad. */
  onStart?: () => void;
  /** Poll a gamepad. Default true. */
  gamepad?: boolean;
}

export function listFocusable(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  return all.filter((el) => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none');
}

/** Make exactly `current` the tab stop. */
export function rove(items: HTMLElement[], current: HTMLElement | null): void {
  let stop = current && items.includes(current) ? current : null;
  if (!stop) stop = items.find((el) => el === document.activeElement) ?? items[0] ?? null;
  for (const el of items) el.tabIndex = el === stop ? 0 : -1;
}

function isRange(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'range';
}

/** Step a slider by one `step`, firing the events React listens for. */
export function nudgeRange(el: HTMLInputElement, dir: 1 | -1): void {
  const step = Number(el.step) || 1;
  const min = el.min === '' ? -Infinity : Number(el.min);
  const max = el.max === '' ? Infinity : Number(el.max);
  const next = Math.max(min, Math.min(max, Number(el.value) + dir * step));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, String(next));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Move focus by `delta` (or to an end) among the container's controls. */
export function moveFocus(container: HTMLElement, delta: number | 'first' | 'last'): HTMLElement | null {
  const items = listFocusable(container);
  if (items.length === 0) return null;
  const active = document.activeElement as HTMLElement | null;
  const at = active ? items.indexOf(active) : -1;
  let next: number;
  if (delta === 'first') next = 0;
  else if (delta === 'last') next = items.length - 1;
  else next = at < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, at + delta));
  const el = items[next];
  rove(items, el);
  el.focus();
  el.scrollIntoView?.({ block: 'nearest' });
  return el;
}

/** One navigation action, from the keyboard or the pad. */
export function applyMenuAction(container: HTMLElement, action: MenuAction): boolean {
  const active = document.activeElement as HTMLElement | null;
  switch (action) {
    case 'up':
      moveFocus(container, -1);
      return true;
    case 'down':
      moveFocus(container, 1);
      return true;
    case 'left':
    case 'right':
      if (isRange(active)) {
        nudgeRange(active, action === 'right' ? 1 : -1);
      } else {
        moveFocus(container, action === 'right' ? 1 : -1);
      }
      return true;
    case 'confirm':
      if (active && container.contains(active) && !isRange(active)) {
        active.click();
        return true;
      }
      return false;
    default:
      return false;
  }
}

/**
 * Wire one menu container: roving tabindex, arrow keys, and — when `gamepad` —
 * the d-pad / stick / A / B / Start poll. Returns the disposer.
 */
export function attachMenuFocus(
  container: HTMLElement,
  optionsRef: RefObject<MenuFocusOptions>,
  gamepad: boolean,
): () => void {
  rove(listFocusable(container), null);

  const onFocusIn = (e: FocusEvent) => {
    rove(listFocusable(container), e.target as HTMLElement);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement;
    if (!active || !container.contains(active)) return;
    let handled: boolean;
    switch (e.key) {
      case 'ArrowUp':
        handled = applyMenuAction(container, 'up');
        break;
      case 'ArrowDown':
        handled = applyMenuAction(container, 'down');
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        // A slider keeps its native Left/Right.
        if (isRange(active)) return;
        handled = applyMenuAction(container, e.key === 'ArrowLeft' ? 'left' : 'right');
        break;
      case 'Home':
        if (isRange(active)) return;
        handled = moveFocus(container, 'first') !== null;
        break;
      case 'End':
        if (isRange(active)) return;
        handled = moveFocus(container, 'last') !== null;
        break;
      default:
        return;
    }
    if (handled) e.preventDefault();
  };
  container.addEventListener('focusin', onFocusIn);
  container.addEventListener('keydown', onKeyDown);

  let raf = 0;
  if (gamepad && typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    const state = createMenuNavState();
    const emit = (action: MenuAction) => {
      if (action === 'back') {
        optionsRef.current?.onBack?.();
        return;
      }
      if (action === 'start') {
        optionsRef.current?.onStart?.();
        return;
      }
      // A pad-driven menu with nothing focused yet: put focus on the first control.
      if (!container.contains(document.activeElement)) {
        moveFocus(container, 'first');
        return;
      }
      applyMenuAction(container, action);
    };
    const poll = (now: number) => {
      const pad: PadLike | null = firstStandardPad(navigator.getGamepads() as ArrayLike<PadLike | null>);
      stepMenuNav(state, pad, now, emit);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
  }

  return () => {
    container.removeEventListener('focusin', onFocusIn);
    container.removeEventListener('keydown', onKeyDown);
    cancelAnimationFrame(raf);
  };
}
