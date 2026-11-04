/**
 * scoreSimSystem — scoring and the ghost's sample clock as a SimCore system (#521 A).
 *
 * Moved, not rewritten, from useExperienceLifecycle's per-frame block: the score
 * accrues `speed × dt × multiplier`, and the 10 Hz ghost buffer writes a sample
 * per 0.1 sim seconds. Splits ride on the latter — a split's time is the ghost
 * buffer's length at the moment `segment-enter` fires (SplitRecorder) — so the
 * clock they are read off is now the registry's fixed step in a real frame, a
 * replay and a headless run alike.
 *
 * The HUD mirror (`batchFrameUpdate`, the distance, the OOB envelope) is not
 * sim: it stays in the lifecycle's frame callback.
 */
import type { DebugStageController } from '../debug/debugStages';
import type { SimSystem } from '../sim/core/SimCore';
import { useGameStore } from '../systems/GameState';
import { tickGhostRecording } from '../systems/ghost/GhostRecorder';
import { tickScoreSystem } from '../systems/score/ScoreSystem';

export const SCORE_SIM_ORDER = 90;

export function createScoreSimSystem(debug: DebugStageController): SimSystem {
  return {
    id: 'score',
    order: SCORE_SIM_ORDER,
    step(ctx, dt) {
      if (!debug.isStageEnabled('stateManagement')) return;
      const v = ctx.vehicle;
      if (!v.valid) return;
      try {
        tickScoreSystem(dt, Math.sqrt(v.vx * v.vx + v.vz * v.vz));

        const game = useGameStore.getState();
        if (!game.isPaused && !game.isWipeout && v.posOk) {
          tickGhostRecording(dt, { px: v.x, py: v.y, pz: v.z, qx: v.qx, qy: v.qy, qz: v.qz, qw: v.qw });
        }
      } catch (error) {
        debug.setStageFailure('stateManagement', error);
      }
    },
  };
}
