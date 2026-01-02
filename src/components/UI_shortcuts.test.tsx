import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UI } from './UI';
import { useProgress } from '@react-three/drei';

// Mock dependencies
jest.mock('@react-three/drei', () => ({
  useProgress: jest.fn(),
}));

describe('UI Shortcuts', () => {
  let originalPointerLockElement: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalPointerLockElement = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
  });

  beforeEach(() => {
    (useProgress as unknown as jest.Mock).mockReturnValue({ active: false, progress: 100 });
    // Reset mocked pointer lock
    if (originalPointerLockElement) {
        Object.defineProperty(document, 'pointerLockElement', originalPointerLockElement);
    } else {
        delete (document as any).pointerLockElement;
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalPointerLockElement) {
      Object.defineProperty(document, 'pointerLockElement', originalPointerLockElement);
    } else {
      delete (document as any).pointerLockElement;
    }
  });

  test('R key opens restart confirmation when paused', () => {
    render(<UI />);

    // 1. Start the game (to set hasStarted=true)
    Object.defineProperty(document, 'pointerLockElement', {
      value: document.body,
      writable: true,
      configurable: true
    });
    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    // 2. Pause the game (unlock)
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true
    });
    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    // Verify we see "GAME PAUSED" and "RESTART [R]"
    expect(screen.getByText(/GAME PAUSED/i)).toBeInTheDocument();
    const restartBtn = screen.getByRole('button', { name: /Restart Game/i });
    expect(restartBtn).toBeInTheDocument();
    expect(restartBtn).toHaveTextContent(/\[R\]/); // Check for the hint text

    // 3. Press 'R'
    act(() => {
      fireEvent.keyDown(window, { key: 'r', code: 'KeyR' });
    });

    // 4. Verify Confirmation Dialog appears
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('RESTART GAME?')).toBeInTheDocument();
  });

  test('R key does NOT open confirmation if game has not started', () => {
    render(<UI />);

    // Initial state: hasStarted=false
    expect(screen.queryByText(/GAME PAUSED/i)).not.toBeInTheDocument();

    // Press 'R'
    act(() => {
      fireEvent.keyDown(window, { key: 'r', code: 'KeyR' });
    });

    // Verify NO Confirmation Dialog
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('R key does NOT open confirmation if game is locked (playing)', () => {
    render(<UI />);

    // Start and Lock
    Object.defineProperty(document, 'pointerLockElement', {
      value: document.body,
      writable: true,
      configurable: true
    });
    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    // Press 'R'
    act(() => {
      fireEvent.keyDown(window, { key: 'r', code: 'KeyR' });
    });

    // Verify NO Confirmation Dialog (overlay hidden anyway)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
