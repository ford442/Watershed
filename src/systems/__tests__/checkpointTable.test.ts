import { describe, expect, it } from 'vitest';
import {
  activeCheckpoint,
  resolveRespawnSegment,
  type CheckpointDefinition,
} from '../survival/checkpointTable';

const MEANDER_CHECKPOINTS: CheckpointDefinition[] = [
  { segment: 13, label: 'Approach shelf' },
  { segment: 15, label: 'Splash pool' },
];

describe('checkpointTable', () => {
  it('returns entered segment when no checkpoints exist', () => {
    expect(resolveRespawnSegment([], 7)).toBe(7);
  });

  it('keeps entered segment before the first authored checkpoint', () => {
    expect(resolveRespawnSegment(MEANDER_CHECKPOINTS, 5)).toBe(5);
    expect(resolveRespawnSegment(MEANDER_CHECKPOINTS, 12)).toBe(12);
  });

  it('anchors respawn at approach shelf through the waterfall', () => {
    expect(resolveRespawnSegment(MEANDER_CHECKPOINTS, 13)).toBe(13);
    expect(resolveRespawnSegment(MEANDER_CHECKPOINTS, 14)).toBe(13);
  });

  it('advances respawn to splash pool after segment 15', () => {
    expect(resolveRespawnSegment(MEANDER_CHECKPOINTS, 15)).toBe(15);
    expect(resolveRespawnSegment(MEANDER_CHECKPOINTS, 18)).toBe(15);
    expect(resolveRespawnSegment(MEANDER_CHECKPOINTS, 22)).toBe(15);
  });

  it('reports the active checkpoint label for HUD/debug', () => {
    expect(activeCheckpoint(MEANDER_CHECKPOINTS, 14)?.label).toBe('Approach shelf');
    expect(activeCheckpoint(MEANDER_CHECKPOINTS, 16)?.label).toBe('Splash pool');
    expect(activeCheckpoint(MEANDER_CHECKPOINTS, 2)).toBeNull();
  });
});
