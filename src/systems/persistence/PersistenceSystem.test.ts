import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../GameState';
import {
  buildRunKey,
  clearRivalGhost,
  EROSION_STORE_CAP,
  getCompletedMaps,
  getDefaultPersistence,
  getLastMapId,
  getLaunchHour,
  getRivalGhost,
  getRunBest,
  loadErosionPlane,
  loadPersistence,
  markMapCompleted,
  pruneDailyRecords,
  resetPersistenceForTests,
  saveErosionPlane,
  savePersistence,
  setLastMapId,
  setLaunchHour,
  setRivalGhost,
  STORAGE_KEY,
  updateRunBest,
} from './PersistenceSystem';
import type { WsGhostFile } from '../ghost/ghostExport';
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

  it('remembers last map and completed campaign maps', () => {
    setLastMapId('glacial');
    expect(getLastMapId()).toBe('glacial');

    markMapCompleted('glacial');
    markMapCompleted('glacial');
    markMapCompleted('meander');

    expect(getCompletedMaps()).toEqual(['glacial', 'meander']);
    expect(getLastMapId()).toBe('meander');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.completedMaps).toEqual(['glacial', 'meander']);
    expect(stored.lastMapId).toBe('meander');
  });

  it('persists launch hour in campaign progress', () => {
    expect(setLaunchHour(17)).toBe(17);
    expect(getLaunchHour()).toBe(17);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.launchHour).toBe(17);
  });

  describe('rival ghost storage', () => {
    const file: WsGhostFile = {
      codecVersion: 2,
      mapId: 'meander',
      timeMs: 42_000,
      ghostData: 'abc123',
      exportedAt: 1700000000000,
    };

    it('is empty until a rival is loaded', () => {
      expect(getRivalGhost('meander')).toBeUndefined();
    });

    it('stores and retrieves a rival ghost per map', () => {
      setRivalGhost('meander', file);
      expect(getRivalGhost('meander')).toEqual(file);
      expect(getRivalGhost('hydro_dam')).toBeUndefined();
    });

    it('persists rivals to localStorage', () => {
      setRivalGhost('meander', file);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored.rivals.meander).toEqual(file);
    });

    it('clears a rival without touching other maps', () => {
      setRivalGhost('meander', file);
      setRivalGhost('hydro_dam', { ...file, mapId: 'hydro_dam' });
      clearRivalGhost('meander');
      expect(getRivalGhost('meander')).toBeUndefined();
      expect(getRivalGhost('hydro_dam')).toBeDefined();
    });
  });

  it('keeps a week of Daily River records and never touches free-run bests', () => {
    updateRunBest('meander:12345', { bestScore: 10, bestAirTime: 1, bestTimeMs: 90_000 });
    for (const day of ['2026-10-10', '2026-10-14', '2026-10-15', '2026-10-21']) {
      updateRunBest(`meander@${day}:12345`, { bestScore: 5, bestAirTime: 0, bestTimeMs: 80_000 });
    }
    expect(pruneDailyRecords('2026-10-21')).toBe(2);
    const keys = Object.keys(loadPersistence().runs).sort();
    expect(keys).toEqual(['meander:12345', 'meander@2026-10-15:12345', 'meander@2026-10-21:12345']);
    expect(pruneDailyRecords('2026-10-21')).toBe(0);
  });

  it('keeps the eroded bed per map segment across a reload — tomorrow’s river starts from it', () => {
    const plane = new Float32Array(286);
    plane[40] = 0.2;
    plane[41] = -0.12;
    saveErosionPlane('meander:2', plane, 1000);
    // Write through the shape guard now (saves are debounced), then reload from storage.
    savePersistence(loadPersistence());
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"meander:2"');
    resetPersistenceForTests();
    const back = loadErosionPlane('meander:2', 286)!;
    expect(back[40]).toBeCloseTo(0.2, 2);
    expect(back[41]).toBeCloseTo(-0.12, 2);
    expect(loadErosionPlane('meander:2', 287)).toBeNull();
    expect(loadErosionPlane('meander:3', 286)).toBeNull();
    // A plane worked back to nothing is dropped, not stored as zeros.
    saveErosionPlane('meander:2', new Float32Array(286), 2000);
    expect(loadPersistence().erosion).toBeUndefined();
  });

  it('drops the least recently written beds past the cap', () => {
    // Every value non-zero and distinct-ish: a plane that does not run-length compress.
    const plane = Float32Array.from({ length: 20_000 }, (_, i) => ((i % 200) - 100) / 300);
    const keys = ['glacial:1', 'glacial:2', 'meander:1', 'meander:2', 'hydro:1', 'hydro:2', 'delta:1', 'delta:2', 'lumber:1', 'lumber:2', 'lumber:3'];
    keys.forEach((key, i) => saveErosionPlane(key, plane, 1000 + i));
    const stored = loadPersistence().erosion!;
    const total = Object.values(stored).reduce((sum, r) => sum + r.q.length, 0);
    expect(total).toBeLessThanOrEqual(EROSION_STORE_CAP);
    expect(stored['lumber:3']).toBeDefined();
    expect(stored['glacial:1']).toBeUndefined();
  });
});
