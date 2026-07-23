/**
 * persistenceBootstrap.ts — Hydrates Zustand from PersistenceSystem on boot.
 *
 * Kept separate from PersistenceSystem to avoid circular imports with GameState.
 */

import { useGameStore } from './GameState';
import {
  getRunBest,
  initPersistenceStore,
  loadPersistence,
  type PersistencePayload,
} from './PersistenceSystem';

let unsubscribeStore: (() => void) | null = null;
const PERSIST_DEBOUNCE_MS = 400;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePreferencePersist(mutator: (data: PersistencePayload) => void): void {
  const data = loadPersistence();
  mutator(data);
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    initPersistenceStore(data);
  }, PERSIST_DEBOUNCE_MS);
}

export function hydrateStoreForRun(runKey: string): void {
  const data = loadPersistence();
  const run = getRunBest(runKey);

  useGameStore.setState({
    settings: { ...data.settings },
    vehicleType: data.vehicleType,
    ghostEnabled: data.ghostEnabled,
    highScore: run.bestScore,
  });
}

export function initPersistence(runKey: string): void {
  hydrateStoreForRun(runKey);

  if (unsubscribeStore) return;

  unsubscribeStore = useGameStore.subscribe((state, prev) => {
    const settingsChanged =
      state.settings.quality !== prev.settings.quality ||
      state.settings.soundVolume !== prev.settings.soundVolume;
    const vehicleChanged = state.vehicleType !== prev.vehicleType;
    const ghostChanged = state.ghostEnabled !== prev.ghostEnabled;

    if (!settingsChanged && !vehicleChanged && !ghostChanged) return;

    schedulePreferencePersist((data) => {
      if (settingsChanged) data.settings = { ...state.settings };
      if (vehicleChanged) data.vehicleType = state.vehicleType;
      if (ghostChanged) data.ghostEnabled = state.ghostEnabled;
    });
  });
}

/** Test helper — reset bootstrap subscriptions. */
export function resetPersistenceBootstrapForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
}
