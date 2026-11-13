/**
 * autoJump.ts — the auto-jump assist (#558 D.1): jump on its own just before an
 * authored gap's take-off (`SegmentFrame.gapT`, set from `openFloor` /
 * `launchShelf`). Pure over the published frames; the runner step owns the state.
 */

import { getSegmentFrame, resolveSegmentAnchor } from './segmentFrames';

/** Jump within this far (horizontal metres) before the take-off point. */
export const AUTO_JUMP_LEAD_M = 3.5;

export interface AutoJumpState {
  /** Segment index of the last gap jumped for; -1 none. */
  lastGap: number;
}

export function createAutoJumpState(): AutoJumpState {
  return { lastGap: -1 };
}

/**
 * True when the runner at (x, z), on `segmentIndex`, should jump now. Looks at
 * this segment's gap and the next one's (an open floor's lip is the next
 * segment's t = 0). Fires once per gap; respawning behind it re-arms it.
 */
export function autoJumpDue(state: AutoJumpState, segmentIndex: number, x: number, z: number): boolean {
  if (state.lastGap > segmentIndex + 1) state.lastGap = -1;
  for (let i = segmentIndex; i <= segmentIndex + 1; i += 1) {
    if (i === state.lastGap) continue;
    const frame = getSegmentFrame(i);
    if (!frame || frame.gapT === undefined) continue;
    const t = frame.gapT;
    const [gx, , gz] = resolveSegmentAnchor(frame, { t, lateral: 0 });
    // Downstream at the take-off: the centreline's direction just before it.
    const [px, , pz] = resolveSegmentAnchor(frame, { t: Math.max(0, t - 0.05), lateral: 0 });
    let dx = gx - px;
    let dz = gz - pz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      dx = 0;
      dz = -1;
    } else {
      dx /= len;
      dz /= len;
    }
    // Still upstream of the take-off, and within the lead of it.
    const ahead = (gx - x) * dx + (gz - z) * dz;
    if (ahead > 0 && ahead <= AUTO_JUMP_LEAD_M && Math.hypot(gx - x, gz - z) <= AUTO_JUMP_LEAD_M * 3) {
      state.lastGap = i;
      return true;
    }
  }
  return false;
}
