import { useGameStore } from './GameState';
import { resetLaunchScoringSession, cancelLaunch } from './LaunchScoringSession';
import { getRunBest, updateRunBest } from './PersistenceSystem';
import { persistGhostRecording, startGhostRecording } from './GhostRecorder';
import { getActiveRunKey } from '../utils/runContext';

const HIGH_SPEED_THRESHOLD = 15;
const RESET_SPEED_THRESHOLD = 8;
const MULTIPLIER_INTERVAL = 5;
const MAX_MULTIPLIER = 10;
const MAX_FRAME_DELTA = 0.1;
const DODGE_BONUS = 200;
const WATERFALL_BONUS = 500;

const COMBO_LABELS: Record<number, string> = {
  2: 'FLOW STATE',
  4: 'ON FIRE',
  6: 'UNSTOPPABLE',
  8: 'LEGENDARY',
};

let highSpeedAccum = 0;
let belowResetAccum = 0;
let comboFlashRemaining = 0;

function maybeBeatHighScore(score: number): number {
  const state = useGameStore.getState();
  const floored = Math.floor(score);
  if (floored <= state.highScore) return state.highScore;

  const runKey = getActiveRunKey();
  updateRunBest(runKey, { bestScore: floored });
  persistGhostRecording(runKey);
  return floored;
}

export function resetScoreSystemState(): void {
  highSpeedAccum = 0;
  belowResetAccum = 0;
  comboFlashRemaining = 0;
  resetLaunchScoringSession();

  const runKey = getActiveRunKey();
  const best = getRunBest(runKey);
  useGameStore.setState({
    score: 0,
    multiplier: 1,
    topSpeed: 0,
    comboLabel: '',
    highScore: best.bestScore,
    launchPopup: null,
    latestReward: null,
  });

  startGhostRecording();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('watershed-run-reset'));
  }
}

export { cancelLaunch };

export function tickScoreSystem(deltaTime: number, speed: number): void {
  const dt = Math.min(Math.max(deltaTime, 0), MAX_FRAME_DELTA);
  if (dt <= 0) return;

  const state = useGameStore.getState();
  if (state.isPaused || state.isWipeout) return;

  let score = state.score + speed * dt * Math.max(1, state.multiplier);
  let multiplier = state.multiplier;
  let topSpeed = Math.max(state.topSpeed, speed);
  let comboLabel = state.comboLabel;
  let highScore = state.highScore;

  if (speed >= HIGH_SPEED_THRESHOLD) {
    highSpeedAccum += dt;
    belowResetAccum = 0;
    const targetMultiplier = Math.min(
      MAX_MULTIPLIER,
      1 + Math.floor(highSpeedAccum / MULTIPLIER_INTERVAL)
    );
    if (targetMultiplier !== multiplier) {
      multiplier = targetMultiplier;
      comboLabel = COMBO_LABELS[targetMultiplier] ?? '';
      comboFlashRemaining = comboLabel ? 1.2 : 0;
    }
  } else if (speed < RESET_SPEED_THRESHOLD) {
    belowResetAccum += dt;
    if (belowResetAccum >= 0.5) {
      highSpeedAccum = 0;
      belowResetAccum = 0;
      if (multiplier !== 1 || comboLabel) {
        multiplier = 1;
        comboLabel = '';
      }
      comboFlashRemaining = 0;
    }
  } else {
    belowResetAccum = 0;
  }

  if (comboFlashRemaining > 0) {
    comboFlashRemaining = Math.max(0, comboFlashRemaining - dt);
    if (comboFlashRemaining === 0) comboLabel = '';
  }

  if (score > highScore) {
    highScore = maybeBeatHighScore(score);
  }

  useGameStore.setState({
    score,
    multiplier,
    topSpeed,
    comboLabel,
    highScore,
  });
}

function addScoreBonus(points: number): void {
  const state = useGameStore.getState();
  if (state.isWipeout) return;

  const delta = points * Math.max(1, state.multiplier);
  const score = state.score + delta;
  const highScore = score > state.highScore ? maybeBeatHighScore(score) : state.highScore;
  useGameStore.setState({ score, highScore });
}

export function awardWaterfallBonus(): void {
  addScoreBonus(WATERFALL_BONUS);
}

export function awardDodgeBonus(): void {
  addScoreBonus(DODGE_BONUS);
}

/** Commit journey-end score to per-run persistence. */
export function commitJourneyScore(): void {
  const { score, highScore } = useGameStore.getState();
  const floored = Math.floor(score);
  if (floored > highScore) {
    const next = maybeBeatHighScore(score);
    useGameStore.setState({ highScore: next });
  }
}
