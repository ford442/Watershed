/**
 * launchRewards.ts — a scored shelf launch onto the store and the run bests (#556 A).
 *
 * LaunchScoringSession is sim code (the vehicle steps tick it) and emits what
 * happened; this is the browser half that used to sit inline in it: the HUD's
 * tier popup, the combo multiplier, score / high score, the PB persistence and
 * the ghost it keeps. A headless run does not subscribe it. Listeners run
 * synchronously inside the step, so the store sees the reward in the same
 * step it did before.
 */
import { useGameStore } from '../GameState';
import { gameEvents } from '../events/GameEvents';
import { updateRunBest } from '../persistence/PersistenceSystem';
import { persistGhostRecording } from '../ghost/GhostRecorder';
import { getActiveRunKey } from '../../utils/runContext';
import { tierDisplayLabel } from './scoreLaunch';

const MAX_MULTIPLIER = 10;

let rewardIdCounter = 0;
let popupIdCounter = 0;
let off: (() => void) | null = null;

/** Wire `launch-started` / `launch-scored` → store + persistence (once at app boot; idempotent). */
export function initLaunchRewardListener(): void {
  if (off) return;
  const offs = [
    gameEvents.on('launch-started', ({ labelKey }) => {
      popupIdCounter += 1;
      useGameStore.setState({ launchPopup: { labelKey, id: popupIdCounter } });
    }),
    gameEvents.on('launch-scored', (result) => {
      const state = useGameStore.getState();
      if (state.isWipeout) return;

      const multiplier = result.comboDelta > 0
        ? Math.min(MAX_MULTIPLIER, state.multiplier + result.comboDelta)
        : state.multiplier;

      const score = state.score + result.score * Math.max(1, state.multiplier);
      const runKey = getActiveRunKey();
      let highScore = state.highScore;
      if (score > highScore) {
        highScore = Math.floor(score);
        updateRunBest(runKey, { bestScore: highScore });
        persistGhostRecording(runKey);
      }

      updateRunBest(runKey, { bestAirTime: result.airTimeSec });

      rewardIdCounter += 1;
      useGameStore.setState({
        score,
        multiplier,
        highScore,
        latestReward: {
          tier: result.tier,
          score: result.score,
          clean: result.clean,
          id: rewardIdCounter,
          labelKey: tierDisplayLabel(result.tier),
        },
      });
    }),
  ];
  off = () => {
    for (const o of offs) o();
  };
}

/** Unsubscribe (tests: pair with `gameEvents.clear()`). */
export function resetLaunchRewardListenerForTests(): void {
  off?.();
  off = null;
}
