import React, { useRef, useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { useMenuFocus, preloadMenuFocus } from './useMenuFocus';
import { moveFocus, nudgeRange } from '../input/menuFocusImpl';
import { createMenuNavState, stepMenuNav, MENU_REPEAT_DELAY_MS, MENU_REPEAT_RATE_MS, type MenuAction } from '../input/menuNav';
import type { PadLike } from '../input/sources/gamepadMapping';

function pad(over: { buttons?: Record<number, number>; axes?: number[] } = {}): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const v = over.buttons?.[i] ?? 0;
    return { pressed: v > 0.5, value: v };
  });
  return { connected: true, mapping: 'standard', axes: over.axes ?? [0, 0, 0, 0], buttons };
}

function collect(state: ReturnType<typeof createMenuNavState>, p: PadLike | null, t: number): MenuAction[] {
  const out: MenuAction[] = [];
  stepMenuNav(state, p, t, (a) => out.push(a));
  return out;
}

describe('menu navigation state machine', () => {
  it('ignores a button that was already down when navigation began', () => {
    const s = createMenuNavState();
    expect(collect(s, pad({ buttons: { 9: 1 } }), 0)).toEqual([]);
    expect(collect(s, pad(), 16)).toEqual([]);
    expect(collect(s, pad({ buttons: { 9: 1 } }), 32)).toEqual(['start']);
  });

  it('maps d-pad, stick, A and B and fires once per press', () => {
    const s = createMenuNavState();
    collect(s, pad(), 0);
    expect(collect(s, pad({ buttons: { 13: 1 } }), 10)).toEqual(['down']);
    expect(collect(s, pad({ buttons: { 13: 1 } }), 20)).toEqual([]);
    collect(s, pad(), 30);
    expect(collect(s, pad({ axes: [0, -0.9, 0, 0] }), 40)).toEqual(['up']);
    collect(s, pad(), 50);
    expect(collect(s, pad({ buttons: { 0: 1 } }), 60)).toEqual(['confirm']);
    collect(s, pad(), 70);
    expect(collect(s, pad({ buttons: { 1: 1 } }), 80)).toEqual(['back']);
  });

  it('repeats a held direction after the delay, at the repeat rate, but never a button', () => {
    const s = createMenuNavState();
    collect(s, pad(), 0);
    const held = pad({ buttons: { 13: 1, 0: 1 } });
    expect(collect(s, held, 100)).toEqual(['down', 'confirm']);
    expect(collect(s, held, 100 + MENU_REPEAT_DELAY_MS - 1)).toEqual([]);
    expect(collect(s, held, 100 + MENU_REPEAT_DELAY_MS)).toEqual(['down']);
    expect(collect(s, held, 100 + MENU_REPEAT_DELAY_MS + MENU_REPEAT_RATE_MS)).toEqual(['down']);
  });

  it('treats a missing pad as everything released', () => {
    const s = createMenuNavState();
    expect(collect(s, null, 0)).toEqual([]);
  });
});

function Menu({ onBack, enabled = true }: { onBack?: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vol, setVol] = useState(0.5);
  const [clicks, setClicks] = useState(0);
  useMenuFocus(ref, { onBack, enabled, gamepad: false });
  return (
    <div ref={ref}>
      <button>One</button>
      <button>Two</button>
      <input type="range" min={0} max={1} step={0.1} value={vol} onChange={(e) => setVol(parseFloat(e.target.value))} aria-label="vol" />
      <button onClick={() => setClicks((c) => c + 1)}>Clicks {clicks}</button>
      <button disabled>Disabled</button>
    </div>
  );
}

describe('useMenuFocus', () => {
  // The engine is fetched on demand; the app has it by the time a menu is up.
  beforeAll(async () => {
    await preloadMenuFocus();
  });

  it('makes exactly one control the tab stop and moves it with the arrows', () => {
    const { getByText } = render(<Menu />);
    const one = getByText('One');
    const two = getByText('Two');
    expect(one.tabIndex).toBe(0);
    expect(two.tabIndex).toBe(-1);

    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(two);
    expect(two.tabIndex).toBe(0);
    expect(one.tabIndex).toBe(-1);

    fireEvent.keyDown(two, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(one);
  });

  it('skips disabled controls, and Home / End jump to the ends', () => {
    const { getByText } = render(<Menu />);
    const last = getByText(/Clicks/);
    const one = getByText('One');
    one.focus();
    fireEvent.keyDown(one, { key: 'End' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(last); // the disabled button is not a stop
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(one);
  });

  it('leaves Left / Right to a focused slider but moves focus on Up / Down', () => {
    const { getByLabelText, getByText } = render(<Menu />);
    const slider = getByLabelText('vol') as HTMLInputElement;
    slider.focus();
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    slider.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(getByText('Two'));
  });

  it('does nothing when disabled', () => {
    const { getByText } = render(<Menu enabled={false} />);
    const one = getByText('One');
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(one);
  });

  it('nudgeRange steps by the slider step and clamps', () => {
    const { getByLabelText } = render(<Menu />);
    const slider = getByLabelText('vol') as HTMLInputElement;
    act(() => nudgeRange(slider, 1));
    expect(slider.value).toBe('0.6');
    act(() => {
      for (let i = 0; i < 10; i += 1) nudgeRange(slider, 1);
    });
    expect(slider.value).toBe('1');
  });

  it('moveFocus returns null for an empty container', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(moveFocus(div, 1)).toBeNull();
    div.remove();
  });
});
