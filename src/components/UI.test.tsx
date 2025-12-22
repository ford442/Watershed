import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UI } from './UI';
import { useProgress } from '@react-three/drei';

jest.mock('@react-three/drei', () => ({
  useProgress: jest.fn(),
}));

describe('UI Component', () => {
  let originalPointerLockElement: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalPointerLockElement = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
  });

  beforeEach(() => {
    (useProgress as unknown as jest.Mock).mockReturnValue({ active: false, progress: 100 });
  });

  afterEach(() => {
    // Restore original property or reset
    if (originalPointerLockElement) {
      Object.defineProperty(document, 'pointerLockElement', originalPointerLockElement);
    } else {
      delete (document as any).pointerLockElement;
    }
  });

  test('renders UI overlay with accessible controls info', () => {
    render(<UI />);

    // The overlay should be visible initially (locked=false)
    const startButton = screen.getByRole('button', { name: /Start Game/i });
    expect(startButton).toBeInTheDocument();
    expect(startButton).toHaveTextContent(/CLICK TO ENGAGE/i);

    // Verify accessible structure
    expect(screen.getByRole('list', { name: /Game Controls/i })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Move: A, S, D, Arrow keys, or Right Click/i })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Jump: W or Space key/i })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Look: Mouse movement/i })).toBeInTheDocument();
  });

  test('renders crosshair when pointer is locked', () => {
    // Mock pointerLockElement to simulate locked state
    Object.defineProperty(document, 'pointerLockElement', {
      value: document.body,
      writable: true,
      configurable: true
    });

    render(<UI />);

    const crosshair = screen.getByTestId('crosshair');
    expect(crosshair).toBeInTheDocument();

    // Overlay should be gone
    expect(screen.queryByText(/CLICK TO ENGAGE/i)).not.toBeInTheDocument();
  });

  test('displays resume options when game is paused', () => {
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

    // Verify UI is hidden (playing state)
    expect(screen.queryByText(/WATERSHED/i)).not.toBeInTheDocument();

    // Simulate disengaging pointer lock (Game Pause)
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true
    });

    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    // UI should reappear with Resume text
    expect(screen.getByText(/GAME PAUSED/i)).toBeInTheDocument();

    const resumeButton = screen.getByRole('button', { name: /Resume Game/i });
    expect(resumeButton).toBeInTheDocument();
    expect(resumeButton).toHaveTextContent(/RESUME GAME/i);
  });

  test('disables start button when loading', () => {
    (useProgress as unknown as jest.Mock).mockReturnValue({ active: true, progress: 50 });
    render(<UI />);
    const startButton = screen.getByRole('button');
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveTextContent(/LOADING.../i);
  });

  test('provides a restart button when paused', () => {
    // Mock window.location.reload
    const reloadMock = jest.fn();
    const originalLocation = window.location;

    // Use Object.defineProperty to overwrite location if possible, or delete/assign
    // JSDOM allows deleting location
    delete (window as any).location;
    (window as any).location = { reload: reloadMock };

    render(<UI />);

    // Engage (Start)
    Object.defineProperty(document, 'pointerLockElement', {
      value: document.body,
      writable: true,
      configurable: true
    });
    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    // Disengage (Pause)
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true
    });
    act(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

    const restartButton = screen.getByRole('button', { name: /Restart Level/i });
    expect(restartButton).toBeInTheDocument();

    restartButton.click();
    expect(reloadMock).toHaveBeenCalled();

    // Restore
    window.location = originalLocation;
  });
});
