import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UI } from './UI';
import { useProgress } from '@react-three/drei';

jest.mock('@react-three/drei', () => ({
  useProgress: jest.fn(),
}));

describe('UI Component New Features', () => {
  let originalPointerLockElement: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalPointerLockElement = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
  });

  beforeEach(() => {
    (useProgress as unknown as jest.Mock).mockReturnValue({ active: false, progress: 100 });
    // Mock requestPointerLock
    const canvas = document.createElement('canvas');
    canvas.requestPointerLock = jest.fn();
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    if (originalPointerLockElement) {
      Object.defineProperty(document, 'pointerLockElement', originalPointerLockElement);
    } else {
      delete (document as any).pointerLockElement;
    }
    jest.clearAllMocks();
  });

  test('Escape key dismisses the restart confirmation dialog', () => {
    render(<UI />);

    // Simulate engaging pointer lock (Game Start)
    Object.defineProperty(document, 'pointerLockElement', {
      value: document.body,
      writable: true,
      configurable: true
    });
    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    // Simulate disengaging pointer lock (Game Pause)
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true
    });
    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    // Click Restart to open confirmation
    const restartButton = screen.getByRole('button', { name: /Restart Game/i });
    act(() => {
      restartButton.click();
    });

    // Confirmation dialog should be visible
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    // Confirmation dialog should be gone
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Restart button should be back
    expect(screen.getByRole('button', { name: /Restart Game/i })).toBeInTheDocument();
  });

  test('Enter key does NOT resume game when in confirmation dialog', () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const requestPointerLockSpy = jest.spyOn(canvas, 'requestPointerLock');

    render(<UI />);

    // Start then Pause to get to Resume state
    Object.defineProperty(document, 'pointerLockElement', { value: document.body, writable: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('pointerlockchange')); });
    Object.defineProperty(document, 'pointerLockElement', { value: null, writable: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('pointerlockchange')); });

    // Click Restart
    act(() => {
      screen.getByRole('button', { name: /Restart Game/i }).click();
    });

    // Press Enter (on window/body, NOT on a specific button focus)
    // Note: In JSDOM, focus might be on the "YES" button due to the useEffect.
    // We want to test that the "global" Enter handler doesn't trigger handleStart (Resume).
    // The "YES" button handles its own click (Restart).

    // Let's explicitly blur everything to simulate "lost focus" or just global keydown capture
    act(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });

    // Should NOT call requestPointerLock (which means Resume)
    expect(requestPointerLockSpy).not.toHaveBeenCalled();
  });
});
