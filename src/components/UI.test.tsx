import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UI } from './UI';

describe('UI Component', () => {
  let originalPointerLockElement: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalPointerLockElement = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
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
    expect(screen.getByRole('listitem', { name: /Move: W, A, S, D keys/i })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Jump: Space key/i })).toBeInTheDocument();
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
});
