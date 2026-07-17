import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './GameState';
import {
  buildRunKey,
  getDefaultPersistence,
  getRunBest,
  loadPersistence,
  resetPersistenceForTests,
  STORAGE_KEY,
  updateRunBest,
} from './PersistenceSystem';
import { initPersistence, resetPersistenceBootstrapForTests } from './persistenceBootstrap';

describe('PersistenceSystem', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPersistenceForTests();
    resetPersistenceBootstrapForTests();
    useGameStore.getState().resetGameState();
  });

  it('discards corrupt payloads and writes a fresh default save', () => {
    localStorage.setItem(STORAGE_KEY, '{"version":99}');
    const data = loadPersistence();
    expect(data.version).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"version":1');
  });

  it('migrates the legacy watershed_highscore key into the default meander run', () => {
    localStorage.setItem('watershed_highscore', '1337');
    resetPersistenceForTests();
    const data = loadPersistence();
    const key = buildRunKey('meander', 12345);
    expect(data.runs[key]?.bestScore).toBe(1337);
    expect(localStorage.getItem('watershed_highscore')).toBeNull();
  });

  it('hydrates settings, vehicle, ghost toggle, and per-run high score', () => {
    const runKey = buildRunKey('meander', 42);
    const payload = getDefaultPersistence();
    payload.settings = { quality: 'low', soundVolume: 0.25 };
    payload.vehicleType = 'raft';
    payload.ghostEnabled = false;
    payload.runs[runKey] = { bestScore: 900, bestAirTime: 1.5 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    resetPersistenceForTests();

    initPersistence(runKey);

    const state = useGameStore.getState();
    expect(state.settings.quality).toBe('low');
    expect(state.settings.soundVolume).toBe(0.25);
    expect(state.vehicleType).toBe('raft');
    expect(state.ghostEnabled).toBe(false);
    expect(state.highScore).toBe(900);
  });

  it('persists debounced preference changes from the store subscriber', async () => {
    const runKey = buildRunKey('meander', 1);
    initPersistence(runKey);
    useGameStore.getState().setSettings({ quality: 'ultra' });
    useGameStore.getState().setGhostEnabled(false);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.settings.quality).toBe('ultra');
    expect(stored.ghostEnabled).toBe(false);
  });

  it('tracks per-run bests independently', () => {
    const a = buildRunKey('meander', 1);
    const b = buildRunKey('meander', 2);
    updateRunBest(a, { bestScore: 100, bestAirTime: 0.8 });
    updateRunBest(b, { bestScore: 250, bestAirTime: 1.2 });

    expect(getRunBest(a).bestScore).toBe(100);
    expect(getRunBest(b).bestScore).toBe(250);
  });
});
