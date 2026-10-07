import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GameHUD } from './GameHUD';

const { getWasmMock, probeMock } = vi.hoisted(() => ({
  getWasmMock: vi.fn(),
  probeMock: vi.fn(),
}));

vi.mock('../systems/water/WatershedWasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../systems/water/WatershedWasm')>();
  return {
    ...actual,
    getWasm: () => getWasmMock(),
  };
});

vi.mock('../sim/nativeOwner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sim/nativeOwner')>();
  return { ...actual, probeNativeStatus: () => probeMock() };
});

describe('GameHUD native WASM smoke', () => {
  beforeEach(() => {
    getWasmMock.mockReset();
    probeMock.mockReset();
  });

  afterEach(() => {
    // The HUD reads the session's native status; it never loads a module itself.
    expect(getWasmMock).not.toHaveBeenCalled();
  });

  it('shows WASM READY from the sim worker handshake', async () => {
    probeMock.mockResolvedValue({ status: 'ready', where: 'worker', abi: 11 });

    render(<GameHUD />);

    expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM LOADING');

    await waitFor(() => {
      expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM READY');
    });
    expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('SIM WORKER ABI 11');
    expect(screen.queryByTestId('wasm-init-banner')).not.toBeInTheDocument();
  });

  it('names the main-thread module under ?simWorker=0', async () => {
    probeMock.mockResolvedValue({ status: 'ready', where: 'main', abi: 11 });
    render(<GameHUD />);
    await waitFor(() => {
      expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('MAIN ABI 11');
    });
  });

  it('shows WASM OFF without a banner on a native-WebGPU session', async () => {
    probeMock.mockResolvedValue({ status: 'none' });
    render(<GameHUD />);
    await waitFor(() => {
      expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM OFF');
    });
    expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WGSL');
    expect(screen.queryByTestId('wasm-init-banner')).not.toBeInTheDocument();
  });

  it('banners native init failure and does not display the TS fallback smoke number', async () => {
    probeMock.mockResolvedValue({
      status: 'failed',
      error: "Cannot read properties of undefined (reading 'fields')",
      timedOut: false,
      mismatched: false,
    });

    render(<GameHUD />);

    await waitFor(() => {
      expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM FAILED');
    });

    const banner = screen.getByTestId('wasm-init-banner');
    expect(banner).toHaveTextContent('Native WASM failed to init');
    expect(banner).not.toHaveTextContent('timed out');
    expect(banner).toHaveTextContent("Cannot read properties of undefined (reading 'fields')");

    const status = screen.getByTestId('wasm-smoke-status').textContent ?? '';
    expect(status).not.toMatch(/\d/);
    // TS fallback of calculateBuoyancyAndDragFallback(150, 0.4, 0, -3) rounds to 6263.
    expect(screen.queryByText(/6263/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(screen.queryByTestId('wasm-init-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM FAILED');
  });

  it('banners native init timeout distinctly from a throw', async () => {
    probeMock.mockResolvedValue({
      status: 'failed',
      error: 'watershed_native init timed out after 8000ms',
      timedOut: true,
      mismatched: false,
    });

    render(<GameHUD />);

    await waitFor(() => {
      expect(screen.getByTestId('wasm-smoke-status')).toHaveTextContent('WASM FAILED');
    });

    const banner = screen.getByTestId('wasm-init-banner');
    expect(banner).toHaveTextContent('Native WASM init timed out');
    expect(banner).not.toHaveTextContent('failed to init');
    expect(banner).toHaveTextContent('watershed_native init timed out after 8000ms');
  });
});
