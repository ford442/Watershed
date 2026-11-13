/**
 * Every menu control is reachable without a mouse (#558 E.2).
 *
 * For the start menu, each Options page and the pause menu: walk the menu with
 * the keyboard (ArrowDown on the focused control, through the menu focus engine
 * the screens attach) and with a gamepad (d-pad presses through `stepMenuNav`,
 * the poll's own state machine, emitting into the same `applyMenuAction` the
 * poll calls), and require that every visible, enabled control was focused.
 * A control the focus engine cannot see — a `div` with a click handler, a
 * `[role]` the selector misses — fails here.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StartMenu } from '../../components/StartMenu';
import PauseMenu from '../../components/PauseMenu';
import { SettingsPanel } from '../SettingsPanel';
import { preloadMenuFocus } from '../../hooks/useMenuFocus';
import { applyMenuAction } from '../../input/menuFocusImpl';
import { createMenuNavState, stepMenuNav, type MenuAction } from '../../input/menuNav';
import type { PadLike } from '../../input/sources/gamepadMapping';
import { useSettingsStore } from '../../systems/settings/useSettingsStore';

/** What a player must be able to reach: every visible, enabled interactive element. */
function controls(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, select, a[href], [role="tab"], [role="radio"], [role="switch"], [role="option"], [role="checkbox"], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (el) =>
      !(el as HTMLButtonElement).disabled &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !el.closest('[hidden]') &&
      (el as HTMLInputElement).type !== 'hidden' &&
      (el as HTMLInputElement).type !== 'file',
  );
}

const label = (el: Element) =>
  `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`;

/** Focus the first control, then press ArrowDown until focus stops moving. */
function walkKeyboard(root: HTMLElement): Set<Element> {
  const seen = new Set<Element>();
  const first = controls(root)[0];
  act(() => first.focus());
  for (let i = 0; i < 400; i += 1) {
    const active = document.activeElement as HTMLElement;
    seen.add(active);
    act(() => {
      fireEvent.keyDown(active, { key: 'ArrowDown' });
    });
    if (document.activeElement === active) break;
  }
  return seen;
}

function pad(down: boolean): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: down && i === 13, value: down && i === 13 ? 1 : 0 }));
  return { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
}

/** The same walk on a gamepad: d-pad down press / release through the poll's state machine. */
function walkGamepad(root: HTMLElement, container: HTMLElement): Set<Element> {
  const seen = new Set<Element>();
  const state = createMenuNavState();
  let t = 0;
  const emit = (action: MenuAction) => {
    act(() => {
      applyMenuAction(container, action);
    });
  };
  stepMenuNav(state, pad(false), (t += 16), emit);
  act(() => controls(root)[0].focus());
  for (let i = 0; i < 400; i += 1) {
    const active = document.activeElement;
    seen.add(active!);
    stepMenuNav(state, pad(true), (t += 16), emit);
    stepMenuNav(state, pad(false), (t += 16), emit);
    if (document.activeElement === active) break;
  }
  return seen;
}

function expectAllReached(root: HTMLElement, seen: Set<Element>, how: string): void {
  const missed = controls(root).filter((el) => !seen.has(el)).map(label);
  expect(missed, `${how}: unreachable controls`).toEqual([]);
}

beforeAll(async () => {
  await preloadMenuFocus();
});

beforeEach(() => {
  useSettingsStore.setState({ _hasHydrated: true });
});

describe('menus are reachable by keyboard and gamepad alone (#558 E.2)', () => {
  it('start menu', () => {
    const { container } = render(
      <StartMenu onStart={() => {}} selectedMapId="glacial" onSelectMap={() => {}} onOpenOptions={() => {}} />,
    );
    const card = (container.querySelector('.start-menu-card') ?? container) as HTMLElement;
    expectAllReached(card, walkKeyboard(card), 'keyboard');
    expectAllReached(card, walkGamepad(card, card), 'gamepad');
  });

  it('pause menu', () => {
    const { container } = render(
      <PauseMenu onResume={() => {}} onRestart={() => {}} onQuit={() => {}} onOpenOptions={() => {}} />,
    );
    const card = (container.querySelector('.pause-menu-card') ?? container) as HTMLElement;
    expectAllReached(card, walkKeyboard(card), 'keyboard');
    expectAllReached(card, walkGamepad(card, card), 'gamepad');
  });

  it('every Options page', () => {
    const { container } = render(<SettingsPanel onClose={() => {}} />);
    const panel = container.querySelector('.settings-panel') as HTMLElement;
    const tabs = Array.from(panel.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.length).toBe(4);
    for (let i = 0; i < tabs.length; i += 1) {
      // Open the page the way a pad would: focus its tab and confirm.
      const tab = panel.querySelectorAll<HTMLElement>('[role="tab"]')[i];
      act(() => tab.focus());
      act(() => {
        applyMenuAction(panel, 'confirm');
      });
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expectAllReached(panel, walkKeyboard(panel), `keyboard, page ${i}`);
      expectAllReached(panel, walkGamepad(panel, panel), `gamepad, page ${i}`);
    }
  });
});
