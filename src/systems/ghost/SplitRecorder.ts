/**
 * SplitRecorder.ts — checkpoint split telemetry for the active timed run.
 *
 * Listens for `segment-enter` and records one split per segment (first entry
 * wins — re-entering a segment, e.g. after a checkpoint respawn, never
 * overwrites it). A split's `tMs` is read off the ghost recorder's own sample
 * clock (see GhostRecorder.getGhostElapsedMs), so it always lines up with the
 * ghost pose recorded at that instant — no separate wall-clock timer to drift.
 */

import { getGhostElapsedMs, isGhostRecording } from './GhostRecorder';
import type { RunSplitEntry } from './ghostCodec';
import { useGameStore } from '../GameState';
import { getRunBest } from '../persistence/PersistenceSystem';
import { getActiveRunKey } from '../../utils/runContext';

let splits: RunSplitEntry[] = [];
let recordedSegments = new Set<number>();
let nextDeltaId = 0;

/** Record a checkpoint split for `segmentIndex`, if one hasn't been recorded yet this run. */
export function recordSplit(segmentIndex: number, speed: number): RunSplitEntry | null {
  if (!isGhostRecording()) return null;
  if (recordedSegments.has(segmentIndex)) return null;

  recordedSegments.add(segmentIndex);
  const entry: RunSplitEntry = {
    segmentIndex,
    tMs: getGhostElapsedMs(),
    speed,
  };
  splits.push(entry);
  publishSplitDelta(entry);
  return entry;
}

/** Flash the HUD delta (this split vs the PB ghost's split at the same segment). */
function publishSplitDelta(entry: RunSplitEntry): void {
  const pbSplit = getRunBest(getActiveRunKey()).splits?.find(
    (s) => s.segmentIndex === entry.segmentIndex,
  );
  if (!pbSplit) return;

  nextDeltaId += 1;
  useGameStore.getState().setLastSplitDelta({
    deltaSeconds: (entry.tMs - pbSplit.tMs) / 1000,
    id: nextDeltaId,
  });
}

/** Splits recorded so far this run, in checkpoint order. */
export function getRecordedSplits(): RunSplitEntry[] {
  return [...splits];
}

export function resetSplitRecording(): void {
  splits = [];
  recordedSegments = new Set();
}

let listenerAttached = false;

/** Wire `segment-enter` / `watershed-run-reset` → split recording (call once at app boot). */
export function initSplitRecordingListener(): void {
  if (listenerAttached || typeof window === 'undefined') return;
  listenerAttached = true;

  window.addEventListener('segment-enter', (event) => {
    const detail = (event as CustomEvent<{ segmentIndex?: number }>).detail;
    if (!detail || typeof detail.segmentIndex !== 'number') return;
    recordSplit(detail.segmentIndex, useGameStore.getState().currentSpeed);
  });

  window.addEventListener('watershed-run-reset', () => {
    resetSplitRecording();
  });
}
