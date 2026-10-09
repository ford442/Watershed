import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { GameHUD } from './GameHUD';
import { batchFrameUpdate, useGameStore } from '../systems/GameState';
import { resetScoreSystemState, tickScoreSystem } from '../systems/score/ScoreSystem';

const { hudRenders } = vi.hoisted(() => ({ hudRenders: { count: 0 } }));

// GameHUD calls usePlayerBiome exactly once per render of its root.
vi.mock('../systems/GameState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../systems/GameState')>();
  return {
    ...actual,
    usePlayerBiome: () => {
      hudRenders.count += 1;
      return actual.usePlayerBiome();
    },
  };
});

vi.mock('../sim/nativeOwner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sim/nativeOwner')>();
  return { ...actual, probeNativeStatus: () => new Promise(() => {}) };
});

describe('GameHUD render budget (#465 C4)', () => {
  beforeEach(() => {
    useGameStore.getState().resetGameState();
    resetScoreSystemState();
    hudRenders.count = 0;
  });

  it('re-renders the HUD root at most twice over 120 frames at constant speed', () => {
    render(<GameHUD />);
    const mountRenders = hudRenders.count;

    const speed = 20;
    const dt = 1 / 60;
    let z = -10;
    // One act() per frame so React commits each frame separately, as in the game.
    for (let frame = 0; frame < 120; frame += 1) {
      act(() => {
        z -= speed * dt;
        tickScoreSystem(dt, speed);
        batchFrameUpdate({ x: 0, y: 0, z }, speed, 0);
        useGameStore.getState().setDistance(Math.floor(Math.abs(z) * 0.5));
      });
    }

    expect(hudRenders.count - mountRenders).toBeLessThanOrEqual(2);
    // The leaf readouts still track the store.
    expect(screen.getByText('20')).toBeInTheDocument();
  });
});
