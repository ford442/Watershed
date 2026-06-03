import { useGameStore } from './GameState';

const HIGH_SPEED_THRESHOLD = 15;
const RESET_SPEED_THRESHOLD = 8;
const MULTIPLIER_INTERVAL = 5;
const MAX_MULTIPLIER = 10;
const MAX_FRAME_DELTA = 0.1;
const DODGE_BONUS = 200;
const WATERFALL_BONUS = 500;
const HIGH_SCORE_KEY = 'watershed_highscore';

const COMBO_LABELS: Record<number, string> = {
  2: 'FLOW STATE',
  4: 'ON FIRE',
  6: 'UNSTOPPABLE',
  8: 'LEGENDARY',
};

let highSpeedAccum = 0;
let belowResetAccum = 0;
let comboFlashRemaining = 0;

const readStoredHighScore = (): number => {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const persistHighScore = (value: number): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(Math.floor(value)));
  } catch {
    // Ignore storage failures in restrictive/private browser contexts.
  }
};

export function resetScoreSystemState(): void {
  highSpeedAccum = 0;
  belowResetAccum = 0;
  comboFlashRemaining = 0;
  const highScore = Math.max(useGameStore.getState().highScore, readStoredHighScore());
  useGameStore.setState({
    score: 0,
    multiplier: 1,
    topSpeed: 0,
    comboLabel: '',
    highScore,
  });
}

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
    highScore = Math.floor(score);
    persistHighScore(highScore);
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
  let highScore = state.highScore;
  if (score > highScore) {
    highScore = Math.floor(score);
    persistHighScore(highScore);
  }
  useGameStore.setState({ score, highScore });
}

export function awardWaterfallBonus(): void {
  addScoreBonus(WATERFALL_BONUS);
}

export function awardDodgeBonus(): void {
  addScoreBonus(DODGE_BONUS);
}
