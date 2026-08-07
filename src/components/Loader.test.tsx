import React from 'react';
import { render, screen } from '@testing-library/react';
import { Loader } from './Loader';

const defaultProps = {
  gamePhase: 'menu' as const,
  canvasReady: false,
  worldEnabled: false,
};

// Mock useProgress to simulate loading state
vi.mock('@react-three/drei', () => ({
  useProgress: () => ({
    active: true,
    progress: 50,
    item: 'test-asset.jpg',
    errors: [],
  }),
}));

test('renders boot loader while canvas is initializing', () => {
  render(<Loader {...defaultProps} />);
  expect(screen.getByText(/STARTING UP/i)).toBeInTheDocument();
  expect(screen.getByText(/Initializing graphics engine/i)).toBeInTheDocument();
});

test('renders asset progress while booting', () => {
  render(<Loader {...defaultProps} canvasReady />);
  expect(screen.getByText(/SYSTEM INITIALIZATION/i)).toBeInTheDocument();
  expect(screen.getByText(/Loading assets… 50%/i)).toBeInTheDocument();
  expect(screen.getByText(/PROCESSING: test-asset.jpg/i)).toBeInTheDocument();

  const progressbar = screen.getByRole('progressbar');
  expect(progressbar).toHaveAttribute('aria-valuenow', '50');
});

test('renders world loader when entering play mode', () => {
  render(
    <Loader
      gamePhase="playing"
      canvasReady
      worldEnabled
    />,
  );
  expect(screen.getByText(/ENTERING CANYON/i)).toBeInTheDocument();
  expect(screen.getByText(/Loading world… 50%/i)).toBeInTheDocument();
});
