/**
 * hazardLog — the run's hazard transitions and hits, for the ghost and the replay check (#522 A).
 *
 * Listens for `hazard-phase` / `hazard-hit` (hazardSimSystem.ts) and records
 * one entry per event while the ghost is recording, timed on the ghost's own
 * sample clock (GhostRecorder.getGhostElapsedMs) like a split, so a hazard's
 * telegraph lines up with the pose recorded at that instant. The log rides in
 * the `.wsghost` (`hazards[]`, codec v5) and `?replay=` smoke runs compare it
 * across replays next to the splits and the SWE checksums.
 *
 * `dormant` is never logged: every hazard starts there, and a reset puts it back.
 */
import { gameEvents } from '../events/GameEvents';
import { getGhostElapsedMs, isGhostRecording } from '../ghost/GhostRecorder';
import { HAZARD_LOG_MAX_ENTRIES } from '../persistence/PersistenceSystem';
import type { HazardLogEntry } from './hazardTypes';

let log: HazardLogEntry[] = [];

function record(hazardId: string, event: HazardLogEntry['event']): void {
  if (!isGhostRecording() || log.length >= HAZARD_LOG_MAX_ENTRIES) return;
  log.push({ hazardId, event, tMs: getGhostElapsedMs() });
}

/** The run's log so far, in order. */
export function getRecordedHazardLog(): HazardLogEntry[] {
  return [...log];
}

export function resetHazardLog(): void {
  log = [];
}

let listenerAttached = false;

/** Wire the hazard events and `watershed-run-reset` to the log (the hazard runtime calls it on load; idempotent). */
export function initHazardLogListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  gameEvents.on('hazard-phase', ({ hazardId, phase }) => {
    if (phase !== 'dormant') record(hazardId, phase);
  });
  gameEvents.on('hazard-hit', ({ hazardId }) => record(hazardId, 'hit'));
  gameEvents.on('watershed-run-reset', () => resetHazardLog());
}
