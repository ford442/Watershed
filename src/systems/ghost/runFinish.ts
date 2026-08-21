/**
 * runFinish.ts — commit the timed PB (ghost + splits) when a run finishes,
 * and snapshot enough of the "before" state for the results screen to diff
 * this run's splits against the PB that stood *before* this run.
 *
 * "Finish" means the journey-complete transition (setJourneyComplete()),
 * which only fires once per run — either a single map's finish line or a
 * campaign's final map (see TrackManager / useExperienceWorld). Wipeout never
 * calls this: a DNF never sets a time PB, though its splits recorded so far
 * are still readable from SplitRecorder for the results screen's DNF row.
 *
 * commitTimedFinish() is called synchronously at the setJourneyComplete()
 * call sites — before the Zustand flip — not from a useEffect reacting to it.
 * PersistenceSystem's cache isn't observed by React, so a component that
 * renders on isJourneyComplete=true and reads getRunBest() would otherwise
 * race an effect-based commit and could see stale (pre-commit) data on its
 * first paint. Committing before the flip removes the race entirely.
 */

import { getGhostElapsedMs, persistGhostRecording } from './GhostRecorder';
import { getRecordedSplits } from './SplitRecorder';
import { getRunBest } from '../persistence/PersistenceSystem';
import type { RunSplitEntry } from './ghostCodec';

export interface RunFinishSummary {
  runKey: string;
  timeMs: number;
  splits: RunSplitEntry[];
  isNewPB: boolean;
  /** PB time/splits as they stood immediately before this run's commit. */
  previousBestTimeMs?: number;
  previousSplits?: RunSplitEntry[];
}

let lastFinishSummary: RunFinishSummary | null = null;
let committedForRun = false;

/** Idempotent per run — safe to call more than once (e.g. re-entrant callers). */
export function commitTimedFinish(runKey: string): RunFinishSummary | null {
  if (committedForRun) return lastFinishSummary;
  committedForRun = true;

  const timeMs = getGhostElapsedMs();
  if (timeMs <= 0) {
    lastFinishSummary = null;
    return null;
  }

  const splits = getRecordedSplits();
  const before = getRunBest(runKey);
  const isNewPB = persistGhostRecording(runKey, timeMs, splits);

  lastFinishSummary = {
    runKey,
    timeMs,
    splits,
    isNewPB,
    previousBestTimeMs: before.bestTimeMs,
    previousSplits: before.splits,
  };
  return lastFinishSummary;
}

/** The most recent commit's snapshot, for the results screen. Null before any finish. */
export function getLastFinishSummary(): RunFinishSummary | null {
  return lastFinishSummary;
}

let listenerAttached = false;

/** Wire `watershed-run-reset` → re-arm commitTimedFinish (call once at app boot). */
export function initRunFinishListener(): void {
  if (listenerAttached || typeof window === 'undefined') return;
  listenerAttached = true;
  window.addEventListener('watershed-run-reset', () => {
    committedForRun = false;
    lastFinishSummary = null;
  });
}

export function resetRunFinishForTests(): void {
  committedForRun = false;
  lastFinishSummary = null;
}
