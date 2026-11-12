/**
 * useHistoryInput.ts — undo / redo from the keyboard and the gamepad while the
 * River Workshop is open (River Workshop A.2).
 *
 *   Ctrl/Cmd+Z            undo
 *   Ctrl/Cmd+Shift+Z, Ctrl+Y   redo
 *   gamepad LB / RB       undo / redo (standard mapping buttons 4 / 5)
 *
 * A text field keeps its own native undo; number and range inputs do not have
 * a useful one, so the Workshop's history answers there too.
 */
import { useEffect } from 'react';
import { workshopStore } from './workshopStore';

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type === 'text' || type === 'search' || type === '';
}

/** The action a keydown asks for, if any (pure, for tests). */
export function historyKeyAction(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

const LB = 4;
const RB = 5;

export function useHistoryInput(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      const action = historyKeyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'undo') workshopStore.getState().undo();
      else workshopStore.getState().redo();
    };
    window.addEventListener('keydown', onKeyDown);

    // Edge-detected shoulder buttons, polled once a frame while a pad is connected.
    let raf = 0;
    const held = new Map<number, [boolean, boolean]>();
    const poll = () => {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad) continue;
        const lb = !!pad.buttons[LB]?.pressed;
        const rb = !!pad.buttons[RB]?.pressed;
        const [wasLb, wasRb] = held.get(pad.index) ?? [false, false];
        if (lb && !wasLb) workshopStore.getState().undo();
        if (rb && !wasRb) workshopStore.getState().redo();
        held.set(pad.index, [lb, rb]);
      }
      raf = requestAnimationFrame(poll);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(poll);
    };
    const hasPad = () =>
      typeof navigator !== 'undefined' && !!navigator.getGamepads && [...navigator.getGamepads()].some(Boolean);
    if (hasPad()) start();
    window.addEventListener('gamepadconnected', start);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('gamepadconnected', start);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
}
