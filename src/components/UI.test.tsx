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

    // Check visibility via class since JSDOM doesn't parse CSS
    const overlay = startButton.closest('.ui-overlay');
    expect(overlay).toHaveClass('visible');

    // Verify accessible structure
    expect(screen.getByRole('list', { name: /Game Controls/i })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Move: A, S, D, Arrow keys, or Right Click/i })).toBeInTheDocument();

    // Restart button should not be visible initially (not rendered)
    expect(screen.queryByRole('button', { name: /Restart Game/i })).not.toBeInTheDocument();
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
    expect(crosshair).toHaveClass('visible');

    // Overlay should be hidden
    const overlay = screen.getByText(/WATERSHED/i).closest('.ui-overlay');
    expect(overlay).toHaveClass('hidden');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
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
    const overlay = screen.getByText(/WATERSHED/i).closest('.ui-overlay');
    expect(overlay).toHaveClass('hidden');

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
    expect(overlay).toHaveClass('visible');
    expect(screen.getByText(/GAME PAUSED/i)).toBeInTheDocument();

    const resumeButton = screen.getByRole('button', { name: /Resume Game/i });
    expect(resumeButton).toBeInTheDocument();
    expect(resumeButton).toHaveTextContent(/RESUME GAME/i);

    const restartButton = screen.getByRole('button', { name: /Restart Game/i });
    expect(restartButton).toBeInTheDocument();
    expect(restartButton).toHaveTextContent(/RESTART/i);
  });

  test('disables start button when loading', () => {
    (useProgress as unknown as jest.Mock).mockReturnValue({ active: true, progress: 50 });
    render(<UI />);
    const startButton = screen.getByRole('button');
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveTextContent(/LOADING.../i);
  });

  test('provides a restart button with confirmation when paused', () => {
    // Mock window.location.reload
    const reloadMock = jest.fn();
    const originalLocation = window.location;

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

    // 1. Initial State: Restart button visible
    const restartButton = screen.getByRole('button', { name: /Restart Game/i });
    expect(restartButton).toBeInTheDocument();

    // 2. Click Restart: Should trigger confirmation state
    act(() => {
      restartButton.click();
    });

    // Verify confirmation dialog appears
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('RESTART GAME?')).toBeInTheDocument();
    expect(screen.getByText('PROGRESS WILL BE LOST')).toBeInTheDocument();

    // Verify Restart button is gone
    expect(screen.queryByRole('button', { name: "Restart Game - Opens confirmation to reload the page" })).not.toBeInTheDocument();

    // 3. Click No (Cancel)
    const noButton = screen.getByRole('button', { name: /No, Cancel/i });
    act(() => {
      noButton.click();
    });

    // Verify back to initial state
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restart Game/i })).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();

    // 4. Click Restart again -> Click Yes
    act(() => {
      screen.getByRole('button', { name: /Restart Game/i }).click();
    });

    const yesButton = screen.getByRole('button', { name: /Yes, Restart/i });
    yesButton.click();

    expect(reloadMock).toHaveBeenCalled();

    // Restore
    window.location = originalLocation;
  });
});
