import { beforeEach, describe, expect, it } from 'vitest';
import { recordSplit, getRecordedSplits, resetSplitRecording } from './SplitRecorder';
import {
  startGhostRecording,
  resetGhostRecording,
  tickGhostRecording,
  GHOST_SAMPLE_INTERVAL,
} from './GhostRecorder';
import { useGameStore } from '../GameState';
import { resetPersistenceForTests } from '../persistence/PersistenceSystem';

function advance(seconds: number): void {
  const steps = Math.round(seconds / GHOST_SAMPLE_INTERVAL);
  for (let i = 0; i < steps; i += 1) {
    tickGhostRecording(GHOST_SAMPLE_INTERVAL, {
      px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
    });
  }
}

describe('SplitRecorder', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPersistenceForTests();
    resetGhostRecording();
    resetSplitRecording();
    startGhostRecording();
    useGameStore.setState({ lastSplitDelta: null });
  });

  it('records a split with elapsed time derived from the ghost sample clock', () => {
    advance(2.5);
    const entry = recordSplit(3, 12);
    expect(entry).toEqual({ segmentIndex: 3, tMs: 2500, speed: 12 });
    expect(getRecordedSplits()).toEqual([entry]);
  });

  it('ignores a second recording for the same segment — first entry wins', () => {
    advance(1);
    recordSplit(0, 5);
    advance(1);
    const second = recordSplit(0, 9);
    expect(second).toBeNull();
    expect(getRecordedSplits()).toHaveLength(1);
    expect(getRecordedSplits()[0].tMs).toBe(1000);
  });

  it('records nothing while the ghost recorder is stopped', () => {
    resetGhostRecording();
    const entry = recordSplit(0, 5);
    expect(entry).toBeNull();
    expect(getRecordedSplits()).toHaveLength(0);
  });

  it('resetSplitRecording clears splits and allows re-recording the same segment', () => {
    advance(1);
    recordSplit(0, 5);
    resetSplitRecording();
    expect(getRecordedSplits()).toHaveLength(0);

    advance(1);
    const entry = recordSplit(0, 7);
    expect(entry).not.toBeNull();
    expect(getRecordedSplits()).toHaveLength(1);
  });

  it('getRecordedSplits returns a defensive copy', () => {
    advance(1);
    recordSplit(0, 5);
    const first = getRecordedSplits();
    first.push({ segmentIndex: 99, tMs: 0, speed: 0 });
    expect(getRecordedSplits()).toHaveLength(1);
  });
});
