/**
 * LaunchScoringSession.ts — Runtime launch-session state for shelf air-time scoring.
 *
 * Air-time accumulates in physics-step time (world.timestep), not render frames.
 */

import { useGameStore } from './GameState';
import {
  calculateAirTimeScore,
  horizontalDistance,
  MIN_GAP_HORIZONTAL,
  predictLaunchTierLabel,
  tierDisplayLabel,
  type Vec3,
} from './launchScoring';
import { VEHICLE_TUNING } from '../constants/vehicleTuning';

export type ContactSurface = 'terrain' | 'water' | 'airborne';

const SLAB_ENTITY_ID = 'seg14-shelf';
const LEFT_GROUND_DEBOUNCE_STEPS = 3;
const LANDING_DEBOUNCE_STEPS = 2;
const MAX_MULTIPLIER = 10;

interface ActiveLaunch {
  sessionId: string;
  startStep: number;
  cleanLaunch: boolean;
  launchPos: Vec3;
  pendingAirTime: number;
  hasLeftGround: boolean;
  airborneSteps: number;
  landingDebounceSteps: number;
  bodyHandle: number;
}

let activeLaunch: ActiveLaunch | null = null;
let physicsStep = 0;
let rewardIdCounter = 0;
let popupIdCounter = 0;

const HIGH_SCORE_KEY = 'watershed_highscore';

const persistHighScore = (value: number): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(Math.floor(value)));
  } catch {
    // ignore storage failures
  }
};

export function getLaunchPhysicsStep(): number {
  return physicsStep;
}

export function bumpLaunchPhysicsStep(): number {
  physicsStep += 1;
  return physicsStep;
}

export function hasActiveLaunch(): boolean {
  return activeLaunch !== null;
}

export function startLaunch(args: {
  sessionId: string;
  startStep: number;
  cleanLaunch: boolean;
  launchPos: Vec3;
  bodyHandle: number;
  downstreamSpeed: number;
}): void {
  if (activeLaunch) return;

  activeLaunch = {
    sessionId: args.sessionId,
    startStep: args.startStep,
    cleanLaunch: args.cleanLaunch,
    launchPos: { ...args.launchPos },
    pendingAirTime: 0,
    hasLeftGround: false,
    airborneSteps: 0,
    landingDebounceSteps: 0,
    bodyHandle: args.bodyHandle,
  };

  popupIdCounter += 1;
  const label = predictLaunchTierLabel(
    args.downstreamSpeed,
    VEHICLE_TUNING.shelfLaunch.speedThreshold,
  );
  useGameStore.setState({
    launchPopup: { label, id: popupIdCounter },
  });
}

export function accumulateAir(physicsDt: number): void {
  if (!activeLaunch || !Number.isFinite(physicsDt) || physicsDt <= 0) return;
  activeLaunch.pendingAirTime += physicsDt;
}

export function cancelLaunch(): void {
  activeLaunch = null;
}

function commitActiveLaunch(landPos: Vec3): void {
  if (!activeLaunch) return;

  const launch = activeLaunch;
  activeLaunch = null;

  const clearedGap = horizontalDistance(launch.launchPos, landPos) >= MIN_GAP_HORIZONTAL;
  const result = calculateAirTimeScore(launch.pendingAirTime, launch.cleanLaunch, clearedGap);

  if (result.score <= 0) return;

  const state = useGameStore.getState();
  if (state.isWipeout) return;

  const multiplier = result.comboDelta > 0
    ? Math.min(MAX_MULTIPLIER, state.multiplier + result.comboDelta)
    : state.multiplier;

  const score = state.score + result.score * Math.max(1, state.multiplier);
  let highScore = state.highScore;
  if (score > highScore) {
    highScore = Math.floor(score);
    persistHighScore(highScore);
  }

  rewardIdCounter += 1;
  useGameStore.setState({
    score,
    multiplier,
    highScore,
    latestReward: {
      tier: result.tier,
      score: result.score,
      clean: launch.cleanLaunch,
      id: rewardIdCounter,
      label: tierDisplayLabel(result.tier),
    },
  });
}

export function tickLaunchScoring(input: {
  physicsDt: number;
  bodyHandle: number;
  position: Vec3;
  contactSurface: ContactSurface;
  vehicle: 'runner' | 'raft';
}): void {
  if (!activeLaunch || activeLaunch.bodyHandle !== input.bodyHandle) return;

  const launch = activeLaunch;
  const isAirborne = input.contactSurface === 'airborne';

  if (!launch.hasLeftGround) {
    if (isAirborne) {
      launch.airborneSteps += 1;
      if (launch.airborneSteps >= LEFT_GROUND_DEBOUNCE_STEPS) {
        launch.hasLeftGround = true;
      }
    } else {
      launch.airborneSteps = 0;
    }
    return;
  }

  if (isAirborne) {
    accumulateAir(input.physicsDt);
    launch.landingDebounceSteps = 0;
    return;
  }

  const validLanding =
    (input.vehicle === 'runner' && input.contactSurface === 'terrain') ||
    (input.vehicle === 'raft' && input.contactSurface === 'water');

  if (!validLanding) {
    launch.landingDebounceSteps = 0;
    return;
  }

  launch.landingDebounceSteps += 1;
  if (launch.landingDebounceSteps >= LANDING_DEBOUNCE_STEPS) {
    commitActiveLaunch(input.position);
  }
}

export function notifyShelfLaunchImpulse(args: {
  bodyHandle: number;
  launchPos: Vec3;
  downstreamSpeed: number;
}): void {
  const step = bumpLaunchPhysicsStep();
  const cleanLaunch = args.downstreamSpeed >= VEHICLE_TUNING.shelfLaunch.speedThreshold;
  const sessionId = `${args.bodyHandle}-${SLAB_ENTITY_ID}-${step}`;

  startLaunch({
    sessionId,
    startStep: step,
    cleanLaunch,
    launchPos: args.launchPos,
    bodyHandle: args.bodyHandle,
    downstreamSpeed: args.downstreamSpeed,
  });
}

export function resetLaunchScoringSession(): void {
  activeLaunch = null;
  physicsStep = 0;
}
