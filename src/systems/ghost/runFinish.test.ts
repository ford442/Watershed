import { beforeEach, describe, expect, it } from 'vitest';
import { commitTimedFinish, getLastFinishSummary, resetRunFinishForTests } from './runFinish';
import { recordSplit, resetSplitRecording } from './SplitRecorder';
import { startGhostRecording, resetGhostRecording, tickGhostRecording, GHOST_SAMPLE_INTERVAL } from './GhostRecorder';
import { buildRunKey, getRunBest, resetPersistenceForTests, updatePBGhost } from '../persistence/PersistenceSystem';
import { encodeGhostSamples, encodeGhostToBase64 } from './ghostCodec';

function advance(seconds: number): void {
  const steps = Math.round(seconds / GHOST_SAMPLE_INTERVAL);
  for (let i = 0; i < steps; i += 1) {
    tickGhostRecording(GHOST_SAMPLE_INTERVAL, {
      px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
    });
  }
}

describe('commitTimedFinish', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPersistenceForTests();
    resetGhostRecording();
    resetSplitRecording();
    resetRunFinishForTests();
    startGhostRecording();
  });

  it('does nothing (no PB write, null summary) when nothing was recorded', () => {
    const key = buildRunKey('meander', 20);
    const summary = commitTimedFinish(key);
    expect(summary).toBeNull();
    expect(getRunBest(key).bestTimeMs).toBeUndefined();
  });

  it('commits a new PB and snapshots splits + this run as the finish summary', () => {
    const key = buildRunKey('meander', 21);
    advance(1);
    recordSplit(0, 5);
    advance(1);
    recordSplit(5, 10);

    const summary = commitTimedFinish(key);
    expect(summary?.isNewPB).toBe(true);
    expect(summary?.timeMs).toBe(2000);
    expect(summary?.splits).toEqual([
      { segmentIndex: 0, tMs: 1000, speed: 5 },
      { segmentIndex: 5, tMs: 2000, speed: 10 },
    ]);
    expect(summary?.previousBestTimeMs).toBeUndefined();
    expect(getRunBest(key).bestTimeMs).toBe(2000);
  });

  it('snapshots the pre-commit PB as "previous" so results can diff against it', () => {
    const key = buildRunKey('meander', 22);
    const oldPayload = encodeGhostToBase64(encodeGhostSamples([{ px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }]));
    updatePBGhost(key, 5000, oldPayload, [{ segmentIndex: 0, tMs: 2500, speed: 4 }]);

    advance(2); // 2000ms — faster than the 5000ms PB
    recordSplit(0, 6);

    const summary = commitTimedFinish(key);
    expect(summary?.isNewPB).toBe(true);
    expect(summary?.previousBestTimeMs).toBe(5000);
    expect(summary?.previousSplits).toEqual([{ segmentIndex: 0, tMs: 2500, speed: 4 }]);
    // The stored PB now reflects this run.
    expect(getRunBest(key).bestTimeMs).toBe(2000);
  });

  it('does not overwrite a faster existing PB, and reports isNewPB=false', () => {
    const key = buildRunKey('meander', 23);
    const oldPayload = encodeGhostToBase64(encodeGhostSamples([{ px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }]));
    updatePBGhost(key, 500, oldPayload, [{ segmentIndex: 0, tMs: 500, speed: 20 }]);

    advance(2); // 2000ms — slower than the 500ms PB
    recordSplit(0, 6);

    const summary = commitTimedFinish(key);
    expect(summary?.isNewPB).toBe(false);
    expect(getRunBest(key).bestTimeMs).toBe(500);
  });

  it('is idempotent per run — a second call returns the same cached summary', () => {
    const key = buildRunKey('meander', 24);
    advance(1);
    recordSplit(0, 5);

    const first = commitTimedFinish(key);
    advance(5); // more recording after "finish" must not change the committed summary
    const second = commitTimedFinish(key);

    expect(second).toEqual(first);
  });
});
