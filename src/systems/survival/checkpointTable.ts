/**
 * checkpointTable.ts — Pure checkpoint graph for OOB / void-fall respawn.
 *
 * Authored per map in survivalMetadata; runtime picks the latest checkpoint
 * at or behind the player's current segment.
 */

export interface CheckpointDefinition {
  segment: number;
  label: string;
  position?: readonly [number, number, number];
  radius?: number;
}

export type CheckpointTable = ReadonlyArray<CheckpointDefinition>;

/**
 * Given a segment enter event, return the respawn segment index.
 * Falls back to `enteredSegment` when no checkpoints are defined.
 */
export function resolveRespawnSegment(
  checkpoints: CheckpointTable,
  enteredSegment: number,
): number {
  if (!checkpoints.length) return enteredSegment;

  let best: number | null = null;
  for (const cp of checkpoints) {
    if (cp.segment <= enteredSegment) {
      if (best === null || cp.segment > best) {
        best = cp.segment;
      }
    }
  }
  return best ?? enteredSegment;
}

/**
 * Returns the checkpoint that would be used for respawn at `enteredSegment`.
 */
export function activeCheckpoint(
  checkpoints: CheckpointTable,
  enteredSegment: number,
): CheckpointDefinition | null {
  if (!checkpoints.length) return null;

  let best: CheckpointDefinition | null = null;
  for (const cp of checkpoints) {
    if (cp.segment <= enteredSegment) {
      if (!best || cp.segment > best.segment) {
        best = cp;
      }
    }
  }
  return best;
}
