/**
 * LaunchScoringSession.ts — Runtime launch-session state for shelf air-time scoring.
 *
 * Air-time accumulates in physics-step time (world.timestep), not render frames.
 * Transient flight state lives in module scope; Zustand receives popups + final reward only.
 */

import { useGameStore } from './GameState';
import {
  calculateAirTimeScore,
  horizontalDistance,
  MIN_GAP_HORIZONTAL,
  predictLaunchTierLabel,
  tierDisplayLabel,
  type Vec3,
} from './scoreLaunch';
import { VEHICLE_TUNING } from '../constants/vehicleTuning';
import { SHELF_LAUNCH_EVENT, type ShelfLaunchEventDetail } from './shelfLaunchEvents';
import { updateRunBest } from './PersistenceSystem';
import { persistGhostRecording } from './GhostRecorder';
import { getActiveRunKey } from '../utils/runContext';

export type ContactSurface = 'terrain' | 'water' | 'airborne';

const SLAB_ENTITY_ID = 'seg14-shelf';
const LEFT_GROUND_DEBOUNCE_STEPS = 3;
const LANDING_DEBOUNCE_STEPS = 2;
const MAX_MULTIPLIER = 10;

interface ActiveLaunch {
  sessionId: string;
  startStep: number;
  launchPos: Vec3;
  pendingAirTime: number;
  hasLeftGround: boolean;
  airborneSteps: number;
  landingDebounceSteps: number;
  bodyHandle: number;
  wallContactDuringFlight: boolean;
}

let activeLaunch: ActiveLaunch | null = null;
let physicsStep = 0;
let rewardIdCounter = 0;
let popupIdCounter = 0;
let shelfLaunchListenerAttached = false;

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

/** Measured air-time once the ascent debounce has cleared (for imperative HUD reads). */
export function getActiveLaunchAirSeconds(): number {
  if (!activeLaunch?.hasLeftGround) return 0;
  return activeLaunch.pendingAirTime;
}

export function startLaunch(args: {
  sessionId: string;
  startStep: number;
  launchPos: Vec3;
  bodyHandle: number;
  downstreamSpeed: number;
}): void {
  if (activeLaunch) return;

  activeLaunch = {
    sessionId: args.sessionId,
    startStep: args.startStep,
    launchPos: { ...args.launchPos },
    pendingAirTime: 0,
    hasLeftGround: false,
    airborneSteps: 0,
    landingDebounceSteps: 0,
    bodyHandle: args.bodyHandle,
    wallContactDuringFlight: false,
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

export function recordLaunchWallContact(): void {
  if (!activeLaunch?.hasLeftGround) return;
  activeLaunch.wallContactDuringFlight = true;
}

export function cancelLaunch(): void {
  activeLaunch = null;
}

function commitActiveLaunch(landPos: Vec3, landedInSplashWater: boolean): void {
  if (!activeLaunch) return;

  const launch = activeLaunch;
  activeLaunch = null;

  const clearedGap = horizontalDistance(launch.launchPos, landPos) >= MIN_GAP_HORIZONTAL;
  const result = calculateAirTimeScore(
    launch.pendingAirTime,
    landedInSplashWater,
    clearedGap,
    launch.wallContactDuringFlight,
  );

  if (result.score <= 0) return;

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

  updateRunBest(runKey, { bestAirTime: launch.pendingAirTime });

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
    (input.vehicle === 'runner' &&
      (input.contactSurface === 'terrain' || input.contactSurface === 'water')) ||
    (input.vehicle === 'raft' && input.contactSurface === 'water');

  if (!validLanding) {
    launch.landingDebounceSteps = 0;
    return;
  }

  launch.landingDebounceSteps += 1;
  if (launch.landingDebounceSteps >= LANDING_DEBOUNCE_STEPS) {
    commitActiveLaunch(input.position, input.contactSurface === 'water');
  }
}

export function notifyShelfLaunchImpulse(args: {
  bodyHandle: number;
  launchPos: Vec3;
  downstreamSpeed: number;
}): void {
  const step = bumpLaunchPhysicsStep();
  const sessionId = `${args.bodyHandle}-${SLAB_ENTITY_ID}-${step}`;

  startLaunch({
    sessionId,
    startStep: step,
    launchPos: args.launchPos,
    bodyHandle: args.bodyHandle,
    downstreamSpeed: args.downstreamSpeed,
  });
}

/** Wire shelfLaunch CustomEvent → scoring session (call once at app boot). */
export function initShelfLaunchScoringListener(): void {
  if (shelfLaunchListenerAttached || typeof window === 'undefined') return;
  shelfLaunchListenerAttached = true;

  window.addEventListener(SHELF_LAUNCH_EVENT, (event) => {
    const detail = (event as CustomEvent<ShelfLaunchEventDetail>).detail;
    if (!detail) return;
    notifyShelfLaunchImpulse(detail);
  });
}

export function resetLaunchScoringSession(): void {
  activeLaunch = null;
  physicsStep = 0;
}
