/**
 * LaunchScoringSession.test.ts — Stateful launch-session transition coverage.
 *
 * Pure logic harness: synthetic tickLaunchScoring inputs, no R3F / Rapier.
 */

import { useGameStore } from './GameState';
import {
  AIR_TIME_THRESHOLDS,
  CLEAN_LAUNCH_SCORE_MULTIPLIER,
  MIN_GAP_HORIZONTAL,
  TIER_SCORES,
} from './scoreLaunch';
import { VEHICLE_TUNING } from '../constants/vehicleTuning';
import { SHELF_LAUNCH_EVENT } from './shelfLaunchEvents';
import {
  cancelLaunch,
  getActiveLaunchAirSeconds,
  hasActiveLaunch,
  initShelfLaunchScoringListener,
  notifyShelfLaunchImpulse,
  recordLaunchWallContact,
  resetLaunchScoringSession,
  startLaunch,
  tickLaunchScoring,
  type ContactSurface,
} from './LaunchScoringSession';
import { resetPersistenceForTests } from './PersistenceSystem';
import { getActiveRunKey } from '../utils/runContext';

const BODY_HANDLE = 42;
const OTHER_BODY_HANDLE = 99;
const PHYSICS_DT = 0.1;

/** Matches LaunchScoringSession.ts — lock current debounce behavior in tests. */
const LEFT_GROUND_DEBOUNCE_STEPS = 3;
const LANDING_DEBOUNCE_STEPS = 2;

const LAUNCH_POS = { x: 0, y: 10, z: 0 };
/** Horizontal distance 10 ≥ MIN_GAP_HORIZONTAL (6). */
const FAR_LAND_POS = { x: 0, y: 0, z: -10 };
/** Horizontal distance 3 < MIN_GAP_HORIZONTAL (6). */
const NEAR_LAND_POS = { x: 3, y: 0, z: 0 };

function resetStore(overrides: Partial<ReturnType<typeof useGameStore.getState>> = {}): void {
  useGameStore.getState().resetGameState();
  useGameStore.setState({
    score: 0,
    multiplier: 1,
    highScore: 0,
    isWipeout: false,
    launchPopup: null,
    latestReward: null,
    ...overrides,
  });
}

function startDefaultLaunch(overrides: Partial<Parameters<typeof startLaunch>[0]> = {}): void {
  startLaunch({
    sessionId: 'test-session',
    startStep: 1,
    launchPos: LAUNCH_POS,
    bodyHandle: BODY_HANDLE,
    downstreamSpeed: 16,
    ...overrides,
  });
}

function tick(input: {
  contactSurface: ContactSurface;
  vehicle?: 'runner' | 'raft';
  bodyHandle?: number;
  position?: { x: number; y: number; z: number };
  physicsDt?: number;
}): void {
  tickLaunchScoring({
    physicsDt: input.physicsDt ?? PHYSICS_DT,
    bodyHandle: input.bodyHandle ?? BODY_HANDLE,
    position: input.position ?? LAUNCH_POS,
    contactSurface: input.contactSurface,
    vehicle: input.vehicle ?? 'runner',
  });
}

function tickAirborne(
  count: number,
  vehicle: 'runner' | 'raft' = 'runner',
  position = LAUNCH_POS,
): void {
  for (let i = 0; i < count; i += 1) {
    tick({ contactSurface: 'airborne', vehicle, position });
  }
}

function tickLanding(
  count: number,
  vehicle: 'runner' | 'raft',
  surface: 'terrain' | 'water',
  position = FAR_LAND_POS,
): void {
  for (let i = 0; i < count; i += 1) {
    tick({ contactSurface: surface, vehicle, position });
  }
}

function completeFlight(args: {
  airTicks: number;
  vehicle?: 'runner' | 'raft';
  landingSurface?: 'terrain' | 'water';
  landPos?: { x: number; y: number; z: number };
}): void {
  const vehicle = args.vehicle ?? 'runner';
  const landingSurface =
    args.landingSurface ?? (vehicle === 'runner' ? 'terrain' : 'water');
  const landPos = args.landPos ?? FAR_LAND_POS;

  tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + args.airTicks, vehicle);
  tickLanding(LANDING_DEBOUNCE_STEPS, vehicle, landingSurface, landPos);
}

describe('LaunchScoringSession', () => {
  beforeEach(() => {
    resetLaunchScoringSession();
    resetStore();
    localStorage.clear();
    resetPersistenceForTests();
  });

  describe('ascent gate', () => {
    it('does not accumulate air-time before LEFT_GROUND_DEBOUNCE_STEPS airborne ticks', () => {
      startDefaultLaunch();

      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(true);
      expect(getActiveLaunchAirSeconds()).toBe(0);
      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });

    it('begins accumulation only after the ascent debounce clears', () => {
      startDefaultLaunch();

      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tickAirborne(1);
      const subMinAccumTicks = Math.floor(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT) - 1;
      tickAirborne(subMinAccumTicks);
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });

    it('resets airborne counter when terrain/water contact occurs before hasLeftGround', () => {
      startDefaultLaunch();

      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tick({ contactSurface: 'terrain' });
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });
  });

  describe('air accumulation', () => {
    it('accumulates physicsDt once hasLeftGround and commits Nice tier score', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks });

      const state = useGameStore.getState();
      expect(state.latestReward).toMatchObject({
        tier: 'Nice',
        score: TIER_SCORES.Nice,
        clean: false,
        label: 'NICE!',
      });
      expect(state.score).toBe(TIER_SCORES.Nice);
    });

    it('exposes measured air-time for imperative HUD reads', () => {
      startDefaultLaunch();
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + 4);
      expect(getActiveLaunchAirSeconds()).toBeCloseTo(0.4, 5);
    });
  });

  describe('runner landing', () => {
    it('requires LANDING_DEBOUNCE_STEPS consecutive terrain ticks to commit', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      tickLanding(1, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();

      tickLanding(1, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(false);
      expect(useGameStore.getState().latestReward).not.toBeNull();
    });

    it('commits on splash-pool water contact for runner', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, landingSurface: 'water' });

      expect(hasActiveLaunch()).toBe(false);
      expect(useGameStore.getState().latestReward).toMatchObject({
        tier: 'Nice',
        clean: true,
      });
    });
  });

  describe('raft landing', () => {
    it('commits on water, not terrain', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, vehicle: 'raft', landingSurface: 'water' });

      expect(useGameStore.getState().latestReward).not.toBeNull();
      expect(useGameStore.getState().score).toBe(
        Math.round(TIER_SCORES.Nice * CLEAN_LAUNCH_SCORE_MULTIPLIER),
      );

      resetLaunchScoringSession();
      resetStore();
      startDefaultLaunch();
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks, 'raft');
      tickLanding(LANDING_DEBOUNCE_STEPS, 'raft', 'terrain');

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(hasActiveLaunch()).toBe(true);
    });
  });

  describe('clean launch rules', () => {
    it('marks launch dirty after a wall contact during flight', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      recordLaunchWallContact();
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'water');

      expect(useGameStore.getState().latestReward).toMatchObject({
        clean: false,
        score: TIER_SCORES.Nice,
      });
    });
  });

  describe('wrong-surface mid-landing', () => {
    it('resets landing debounce when airborne interrupts touchdown', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks, 'runner');
      tickLanding(1, 'runner', 'terrain');
      tick({ contactSurface: 'airborne', vehicle: 'runner', position: LAUNCH_POS });
      tickLanding(1, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();

      tickLanding(1, 'runner', 'terrain');
      expect(useGameStore.getState().latestReward).not.toBeNull();
    });
  });

  describe('double-launch latch', () => {
    it('ignores startLaunch while a session is already active', () => {
      startDefaultLaunch({ sessionId: 'first', downstreamSpeed: 8 });
      const firstPopup = useGameStore.getState().launchPopup;

      startDefaultLaunch({ sessionId: 'second', downstreamSpeed: 20 });

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().launchPopup).toEqual(firstPopup);
    });

    it('ignores notifyShelfLaunchImpulse while a session is active', () => {
      startDefaultLaunch({ sessionId: 'first' });

      notifyShelfLaunchImpulse({
        bodyHandle: BODY_HANDLE,
        launchPos: LAUNCH_POS,
        downstreamSpeed: 20,
      });

      expect(hasActiveLaunch()).toBe(true);
    });

    it('ignores tickLaunchScoring when bodyHandle does not match', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      tickLanding(1, 'runner', 'terrain', FAR_LAND_POS);

      tick({
        contactSurface: 'terrain',
        bodyHandle: OTHER_BODY_HANDLE,
        position: FAR_LAND_POS,
      });
      tick({
        contactSurface: 'terrain',
        bodyHandle: OTHER_BODY_HANDLE,
        position: FAR_LAND_POS,
      });

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();
    });
  });

  describe('gap gate', () => {
    it('commits no score when horizontal gap is below MIN_GAP_HORIZONTAL', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, landPos: NEAR_LAND_POS });

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
      expect(horizontalGap(LAUNCH_POS, NEAR_LAND_POS)).toBeLessThan(MIN_GAP_HORIZONTAL);
    });
  });

  describe('wipeout guard', () => {
    it('does not commit rewards when isWipeout is true', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      useGameStore.setState({ isWipeout: true });
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });

    it('cancelLaunch clears the active session so subsequent ticks are inert', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      cancelLaunch();

      expect(hasActiveLaunch()).toBe(false);
      expect(getActiveLaunchAirSeconds()).toBe(0);

      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');
      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });
  });

  describe('commit side-effects', () => {
    it('applies score with current multiplier and bumps combo on clean splash landing', () => {
      resetStore({ multiplier: 3 });
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, landingSurface: 'water' });

      const expectedBase = Math.round(TIER_SCORES.Nice * CLEAN_LAUNCH_SCORE_MULTIPLIER);
      const state = useGameStore.getState();
      expect(state.score).toBe(expectedBase * 3);
      expect(state.multiplier).toBe(4);
      expect(state.latestReward).toMatchObject({
        tier: 'Nice',
        score: expectedBase,
        clean: true,
      });
    });

    it('caps multiplier at MAX_MULTIPLIER (10) on clean launch combo bump', () => {
      resetStore({ multiplier: 10 });
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, landingSurface: 'water' });

      expect(useGameStore.getState().multiplier).toBe(10);
    });

    it('persists highScore when the new total beats the previous record', () => {
      resetStore({ highScore: 100, score: 500 });
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.GREAT / PHYSICS_DT);
      completeFlight({ airTicks });

      const state = useGameStore.getState();
      expect(state.score).toBeGreaterThan(100);
      expect(state.highScore).toBe(Math.floor(state.score));
      const saved = JSON.parse(localStorage.getItem('watershed_save_v1') || '{}');
      expect(saved.runs[getActiveRunKey()]?.bestScore).toBe(state.highScore);
    });
  });

  describe('popup emission', () => {
    it('sets launchPopup with predicted tier label on startLaunch', () => {
      const threshold = VEHICLE_TUNING.shelfLaunch.speedThreshold;

      startDefaultLaunch({ downstreamSpeed: threshold });
      expect(useGameStore.getState().launchPopup).toMatchObject({ label: 'AIR!' });

      resetLaunchScoringSession();
      resetStore();
      startDefaultLaunch({ downstreamSpeed: 16 });
      expect(useGameStore.getState().launchPopup).toMatchObject({ label: 'GREAT!' });

      resetLaunchScoringSession();
      resetStore();
      startDefaultLaunch({ downstreamSpeed: 20 });
      expect(useGameStore.getState().launchPopup).toMatchObject({ label: 'PERFECT?!' });
    });

    it('sets latestReward with tier and clean flag on qualifying splash landing', () => {
      startDefaultLaunch();

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, landingSurface: 'water' });

      expect(useGameStore.getState().latestReward).toMatchObject({
        tier: 'Nice',
        clean: true,
        label: 'NICE!',
      });
    });
  });

  describe('notifyShelfLaunchImpulse', () => {
    it('starts a session and emits the predictive AIR! popup', () => {
      notifyShelfLaunchImpulse({
        bodyHandle: BODY_HANDLE,
        launchPos: LAUNCH_POS,
        downstreamSpeed: VEHICLE_TUNING.shelfLaunch.speedThreshold,
      });

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().launchPopup).toMatchObject({ label: 'AIR!' });
    });
  });

  describe('shelfLaunch event bridge', () => {
    it('starts a session when the shelfLaunch CustomEvent fires', () => {
      initShelfLaunchScoringListener();

      window.dispatchEvent(
        new CustomEvent(SHELF_LAUNCH_EVENT, {
          detail: {
            bodyHandle: BODY_HANDLE,
            launchPos: LAUNCH_POS,
            downstreamSpeed: 18,
          },
        }),
      );

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().launchPopup).toMatchObject({ label: 'GREAT!' });
    });
  });
});

function horizontalGap(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}
