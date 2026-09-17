import { useGameStore } from '../GameState';
import { RENDER_SCALE_MAX, RENDER_SCALE_MIN } from '../../rendering/renderScale';

describe('GameState.renderScale — the adaptive valve (#419 phase C)', () => {
  beforeEach(() => {
    useGameStore.getState().setRenderScale(RENDER_SCALE_MAX);
  });

  it('starts wide open', () => {
    expect(useGameStore.getState().renderScale).toBe(RENDER_SCALE_MAX);
  });

  it('clamps and quantizes on the way in', () => {
    const { setRenderScale } = useGameStore.getState();

    setRenderScale(0.7);
    expect(useGameStore.getState().renderScale).toBe(0.7);

    setRenderScale(0.73);
    expect(useGameStore.getState().renderScale).toBe(0.7);

    setRenderScale(0.01);
    expect(useGameStore.getState().renderScale).toBe(RENDER_SCALE_MIN);

    setRenderScale(4);
    expect(useGameStore.getState().renderScale).toBe(RENDER_SCALE_MAX);

    setRenderScale(Number.NaN);
    expect(useGameStore.getState().renderScale).toBe(RENDER_SCALE_MAX);
  });

  it('survives a run reset — the valve describes the machine, not the run', () => {
    useGameStore.getState().setRenderScale(0.6);
    useGameStore.getState().resetGameState();
    expect(useGameStore.getState().renderScale).toBe(0.6);
  });

  it('is not a setting: the quality preset and the valve move independently', () => {
    useGameStore.getState().setRenderScale(0.6);
    useGameStore.getState().setSettings({ quality: 'ultra' });
    expect(useGameStore.getState().settings.quality).toBe('ultra');
    expect(useGameStore.getState().renderScale).toBe(0.6);
    expect(useGameStore.getState().settings).not.toHaveProperty('renderScale');
  });
});
