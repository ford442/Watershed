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
  const { getByText } = render(<Loader />);
  expect(getByText(/SYSTEM INITIALIZATION/i)).toBeInTheDocument();
  expect(getByText(/LOADING ASSETS... 50%/i)).toBeInTheDocument();
  expect(getByText(/PROCESSING: test-asset.jpg/i)).toBeInTheDocument();
});
