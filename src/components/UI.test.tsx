import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UI } from './UI';

test('renders UI overlay with controls info', () => {
  render(<UI />);

  // The overlay should be visible initially (locked=false)
  const startButton = screen.getByRole('button', { name: /Start Game/i });
  expect(startButton).toBeInTheDocument();
  expect(startButton).toHaveTextContent(/CLICK TO ENGAGE/i);

  const moveControl = screen.getByText(/MOVE/i);
  expect(moveControl).toBeInTheDocument();

  const jumpControl = screen.getByText(/JUMP/i);
  expect(jumpControl).toBeInTheDocument();
});
