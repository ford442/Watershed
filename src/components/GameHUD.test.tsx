import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GameHUD } from './GameHUD';

const { getWasmMock } = vi.hoisted(() => ({
  getWasmMock: vi.fn(),
}));

vi.mock('../systems/water/WatershedWasm', () => ({
  getWasm: () => getWasmMock(),
}));

const nativeForce = {
  forceX: 0,
  forceY: 1,
  forceZ: -12,
  buoyancy: 1,
  drag: 1,
  flow: 1,
  turbulence: 0,
  submergedRatio: 1,
};

describe('GameHUD native WASM smoke', () => {
  beforeEach(() => {
    getWasmMock.mockReset();
  });

  it('shows WASM READY and the native smoke value on successful init', async () => {
    getWasmMock.mockResolvedValue({
      calculateBuoyancyAndDrag: () => 4242.4,
      calculateWaterForce: () => nativeForce,
    });

    render(<GameHUD />);

    expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM LOADING');

    await waitFor(() => {
      expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM READY 4242');
    });
    expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('Fz -12');
    expect(screen.queryByTestId('wasm-init-banner')).not.toBeInTheDocument();
  });

  it('banners native init failure and does not display the TS fallback smoke number', async () => {
    getWasmMock.mockRejectedValue(
      new Error("Cannot read properties of undefined (reading 'fields')"),
    );

    render(<GameHUD />);

    await waitFor(() => {
      expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM FAILED');
    });

    const banner = screen.getByTestId('wasm-init-banner');
    expect(banner).toHaveTextContent('Native WASM failed to init');
    expect(banner).toHaveTextContent("Cannot read properties of undefined (reading 'fields')");

    const status = screen.getByTestId('wasm-smoke-status').textContent ?? '';
    expect(status).not.toMatch(/\d/);
    // TS fallback of calculateBuoyancyAndDragFallback(150, 0.4, 0, -3) rounds to 6263.
    expect(screen.queryByText(/6263/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(screen.queryByTestId('wasm-init-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM FAILED');
  });
});
