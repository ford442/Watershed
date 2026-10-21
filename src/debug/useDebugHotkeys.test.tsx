import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useDebugHotkeys } from './useDebugHotkeys';

function press(code: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, ...init }));
}

describe('useDebugHotkeys', () => {
  it('binds nothing when disabled (production)', () => {
    const actions = { togglePhysicsDebug: vi.fn(), toggleWireframe: vi.fn() };
    renderHook(() => useDebugHotkeys(false, actions));
    press('KeyF');
    press('KeyG');
    expect(actions.togglePhysicsDebug).not.toHaveBeenCalled();
    expect(actions.toggleWireframe).not.toHaveBeenCalled();
  });

  it('F and G toggle when enabled, and the listener is removed on unmount', async () => {
    const actions = { togglePhysicsDebug: vi.fn(), toggleWireframe: vi.fn() };
    const { unmount } = renderHook(() => useDebugHotkeys(true, actions));
    // The key handling is fetched on demand.
    await import('./debugHotkeysImpl');
    await new Promise((r) => setTimeout(r, 0));
    press('KeyF');
    press('KeyG');
    press('KeyF', { repeat: true });
    expect(actions.togglePhysicsDebug).toHaveBeenCalledTimes(1);
    expect(actions.toggleWireframe).toHaveBeenCalledTimes(1);
    unmount();
    press('KeyF');
    expect(actions.togglePhysicsDebug).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed into a text field', async () => {
    const actions = { togglePhysicsDebug: vi.fn(), toggleWireframe: vi.fn() };
    renderHook(() => useDebugHotkeys(true, actions));
    await import('./debugHotkeysImpl');
    await new Promise((r) => setTimeout(r, 0));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
    input.remove();
    expect(actions.togglePhysicsDebug).not.toHaveBeenCalled();
  });
});
