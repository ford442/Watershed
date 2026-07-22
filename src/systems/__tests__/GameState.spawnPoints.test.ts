import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../GameState';

describe('GameState spawn point updates', () => {
  beforeEach(() => {
    useGameStore.getState().resetGameState();
  });

  it('setSpawnPoint is a no-op when the point is unchanged', () => {
    const store = useGameStore.getState();
    store.setSpawnPoint(0, { x: 1, y: 2, z: 3 });
    const first = useGameStore.getState().spawnPoints;

    useGameStore.getState().setSpawnPoint(0, { x: 1, y: 2, z: 3 });
    expect(useGameStore.getState().spawnPoints).toBe(first);
  });

  it('setSpawnPoints merges in a single update', () => {
    useGameStore.getState().setSpawnPoints({
      0: { x: 1, y: 2, z: 3 },
      1: { x: 4, y: 5, z: 6 },
    });
    expect(useGameStore.getState().spawnPoints).toEqual({
      0: { x: 1, y: 2, z: 3 },
      1: { x: 4, y: 5, z: 6 },
    });
  });
});
