import { vi } from 'vitest';
import {
  CAVEAT_FALLBACK_PRESET,
  createGameRendererWithCaveatFallback,
  type CaveatFallbackInfo,
} from './bootRendererFallback';
import { deriveRendererContextOptions } from './deriveRendererContextOptions';
import type { QualityPreset } from '../systems/GameState';

/** Stand-in for THREE.WebGLRenderer — the fallback never touches the instance. */
const RENDERER = { tag: 'renderer' } as any;

const CAVEAT_ERROR = new Error(
  'Error creating WebGL context.',
);

const inputFor = (
  quality: QualityPreset,
  createRenderer: any,
  onCaveatFallback?: (info: CaveatFallbackInfo) => void,
  devicePixelRatio = 1,
) => ({
  quality,
  contextOptions: deriveRendererContextOptions(quality, { devicePixelRatio }),
  devicePixelRatio,
  rendererOptions: { preference: 'webgl' as const, materialBackend: 'glsl' as const },
  onCaveatFallback,
  createRenderer,
});

describe('createGameRendererWithCaveatFallback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first renderer when the context request succeeds', async () => {
    const create = vi.fn().mockResolvedValue(RENDERER);
    const onCaveatFallback = vi.fn();

    await expect(
      createGameRendererWithCaveatFallback({}, inputFor('high', create, onCaveatFallback)),
    ).resolves.toBe(RENDERER);

    expect(create).toHaveBeenCalledTimes(1);
    expect(onCaveatFallback).not.toHaveBeenCalled();
    expect(create.mock.calls[0][1].contextOptions.antialias).toBe(true);
  });

  it('retries once at low when the caveat check rejects the context', async () => {
    const create = vi.fn().mockRejectedValueOnce(CAVEAT_ERROR).mockResolvedValue(RENDERER);
    const onCaveatFallback = vi.fn();

    await expect(
      createGameRendererWithCaveatFallback({}, inputFor('ultra', create, onCaveatFallback, 2)),
    ).resolves.toBe(RENDERER);

    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1][1];
    // The retry really is the `low` contract, not the failed one reused.
    expect(retry.contextOptions).toMatchObject({
      antialias: false,
      dprMax: 1,
      shadowMode: 'off',
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'default',
    });
    expect(retry.antialias).toBe(false);
    expect(retry.powerPreference).toBe('default');
    // Non-context options survive the retry.
    expect(retry.preference).toBe('webgl');
    expect(retry.materialBackend).toBe('glsl');
  });

  it('reports the downgrade once, naming the preset that failed', async () => {
    const create = vi.fn().mockRejectedValueOnce(CAVEAT_ERROR).mockResolvedValue(RENDERER);
    const onCaveatFallback = vi.fn();

    await createGameRendererWithCaveatFallback({}, inputFor('high', create, onCaveatFallback));

    expect(onCaveatFallback).toHaveBeenCalledTimes(1);
    expect(onCaveatFallback).toHaveBeenCalledWith({
      from: 'high',
      to: CAVEAT_FALLBACK_PRESET,
      error: CAVEAT_ERROR,
    });
  });

  it('does not retry when the failed attempt had the caveat check off', async () => {
    // `low`, `?softwareGl=1` and capture mode already accept software GL, so a
    // failure there is a real "no WebGL here" — the error boundary must see it.
    const create = vi.fn().mockRejectedValue(CAVEAT_ERROR);
    const onCaveatFallback = vi.fn();

    await expect(
      createGameRendererWithCaveatFallback({}, inputFor('low', create, onCaveatFallback)),
    ).rejects.toBe(CAVEAT_ERROR);

    expect(create).toHaveBeenCalledTimes(1);
    expect(onCaveatFallback).not.toHaveBeenCalled();
  });

  it('retries only once — a failing low retry propagates', async () => {
    const second = new Error('no webgl at all');
    const create = vi.fn().mockRejectedValueOnce(CAVEAT_ERROR).mockRejectedValueOnce(second);

    await expect(
      createGameRendererWithCaveatFallback({}, inputFor('high', create)),
    ).rejects.toBe(second);

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('forwards the caller canvas props to both attempts', async () => {
    const create = vi.fn().mockRejectedValueOnce(CAVEAT_ERROR).mockResolvedValue(RENDERER);
    const canvasProps = { canvas: {} as HTMLCanvasElement, preserveDrawingBuffer: true };

    await createGameRendererWithCaveatFallback(canvasProps, inputFor('high', create));

    expect(create.mock.calls[0][0]).toBe(canvasProps);
    expect(create.mock.calls[1][0]).toBe(canvasProps);
  });
});
