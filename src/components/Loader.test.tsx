import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Loader } from './Loader';

// Mock useProgress to simulate loading state
jest.mock('@react-three/drei', () => ({
  useProgress: () => ({
    active: true,
    progress: 50,
    item: 'test-asset.jpg',
  }),
}));

test('renders loader when active', () => {
  const { getByText, getByRole } = render(<Loader />);
  expect(getByText(/SYSTEM INITIALIZATION/i)).toBeInTheDocument();
  expect(getByText(/LOADING ASSETS... 50%/i)).toBeInTheDocument();
  expect(getByText(/PROCESSING: test-asset.jpg/i)).toBeInTheDocument();

  const progressbar = getByRole('progressbar');
  expect(progressbar).toBeInTheDocument();
  expect(progressbar).toHaveAttribute('aria-valuenow', '50');
  expect(progressbar).toHaveAttribute('aria-valuemin', '0');
  expect(progressbar).toHaveAttribute('aria-valuemax', '100');
  expect(progressbar).toHaveAttribute('aria-label', 'Asset loading progress');
});
