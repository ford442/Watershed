/**
 * LaunchScoringSession.test.ts — Stateful launch-session transition coverage.
 *
 * Pure logic harness: synthetic tickLaunchScoring inputs, no R3F / Rapier.
 */

import { useGameStore } from './GameState';
import {
  AIR_TIME_THRESHOLDS,
  CLEAN_LAUNCH_BONUS,
  MIN_GAP_HORIZONTAL,
  TIER_SCORES,
} from './launchScoring';
import { VEHICLE_TUNING } from '../constants/vehicleTuning';
import {
  cancelLaunch,
  hasActiveLaunch,
  notifyShelfLaunchImpulse,
  resetLaunchScoringSession,
  startLaunch,
  tickLaunchScoring,
  type ContactSurface,
} from './LaunchScoringSession';

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
    cleanLaunch: true,
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

/** Consecutive airborne physics steps (includes ascent debounce window). */
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

/** Airborne ticks after ascent gate, then landing debounce on the given surface. */
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
  });

  describe('ascent gate', () => {
    it('does not accumulate air-time before LEFT_GROUND_DEBOUNCE_STEPS airborne ticks', () => {
      startDefaultLaunch({ cleanLaunch: false });

      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });

    it('begins accumulation only after the ascent debounce clears', () => {
      startDefaultLaunch({ cleanLaunch: false });

      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tickAirborne(1);
      const subMinAccumTicks = Math.floor(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT) - 1;
      tickAirborne(subMinAccumTicks);
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });

    it('resets airborne counter when terrain/water contact occurs before hasLeftGround', () => {
      startDefaultLaunch({ cleanLaunch: false });

      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tick({ contactSurface: 'terrain' });
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS - 1);
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      // Interrupted ascent never opened accumulation; landing ticks are ignored pre-hasLeftGround.
      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });
  });

  describe('air accumulation', () => {
    it('accumulates physicsDt once hasLeftGround and commits Nice tier score', () => {
      startDefaultLaunch({ cleanLaunch: false });

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
  });

  describe('runner landing', () => {
    it('requires LANDING_DEBOUNCE_STEPS consecutive terrain ticks to commit', () => {
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      tickLanding(1, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();

      tickLanding(1, 'runner', 'terrain');

      expect(hasActiveLaunch()).toBe(false);
      expect(useGameStore.getState().latestReward).not.toBeNull();
    });

    it('does not commit on water contact for runner', () => {
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'water');

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });
  });

  describe('raft landing', () => {
    it('commits on water, not terrain', () => {
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, vehicle: 'raft', landingSurface: 'water' });

      expect(useGameStore.getState().latestReward).not.toBeNull();
      expect(useGameStore.getState().score).toBe(TIER_SCORES.Nice);

      resetLaunchScoringSession();
      resetStore();
      startDefaultLaunch({ cleanLaunch: false });
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks, 'raft');
      tickLanding(LANDING_DEBOUNCE_STEPS, 'raft', 'terrain');

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(hasActiveLaunch()).toBe(true);
    });
  });

  describe('wrong-surface mid-landing', () => {
    it('resets landing debounce without committing on invalid surface contact', () => {
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks, 'runner');
      tickLanding(1, 'runner', 'terrain');
      tick({ contactSurface: 'water', vehicle: 'runner', position: FAR_LAND_POS });
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
      startDefaultLaunch({ cleanLaunch: false });

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
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks, landPos: NEAR_LAND_POS });

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
      expect(horizontalGap(LAUNCH_POS, NEAR_LAND_POS)).toBeLessThan(MIN_GAP_HORIZONTAL);
    });
  });

  describe('wipeout guard', () => {
    it('does not commit rewards when isWipeout is true', () => {
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      useGameStore.setState({ isWipeout: true });
      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');

      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });

    it('cancelLaunch clears the active session so subsequent ticks are inert', () => {
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      tickAirborne(LEFT_GROUND_DEBOUNCE_STEPS + airTicks);
      cancelLaunch();

      expect(hasActiveLaunch()).toBe(false);

      tickLanding(LANDING_DEBOUNCE_STEPS, 'runner', 'terrain');
      expect(useGameStore.getState().latestReward).toBeNull();
      expect(useGameStore.getState().score).toBe(0);
    });
  });

  describe('commit side-effects', () => {
    it('applies score with current multiplier and bumps combo on clean launch', () => {
      resetStore({ multiplier: 3 });
      startDefaultLaunch({ cleanLaunch: true });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks });

      const expectedBase = TIER_SCORES.Nice + CLEAN_LAUNCH_BONUS;
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
      startDefaultLaunch({ cleanLaunch: true });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks });

      expect(useGameStore.getState().multiplier).toBe(10);
    });

    it('persists highScore when the new total beats the previous record', () => {
      resetStore({ highScore: 100, score: 500 });
      startDefaultLaunch({ cleanLaunch: false });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.GREAT / PHYSICS_DT);
      completeFlight({ airTicks });

      const state = useGameStore.getState();
      expect(state.score).toBeGreaterThan(100);
      expect(state.highScore).toBe(Math.floor(state.score));
      expect(localStorage.getItem('watershed_highscore')).toBe(String(state.highScore));
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

    it('sets latestReward with tier and clean flag on qualifying commit', () => {
      startDefaultLaunch({ cleanLaunch: true });

      const airTicks = Math.ceil(AIR_TIME_THRESHOLDS.MIN_REWARD / PHYSICS_DT);
      completeFlight({ airTicks });

      expect(useGameStore.getState().latestReward).toMatchObject({
        tier: 'Nice',
        clean: true,
        label: 'NICE!',
      });
    });
  });

  describe('notifyShelfLaunchImpulse', () => {
    it('starts a session with cleanLaunch derived from speed threshold', () => {
      notifyShelfLaunchImpulse({
        bodyHandle: BODY_HANDLE,
        launchPos: LAUNCH_POS,
        downstreamSpeed: VEHICLE_TUNING.shelfLaunch.speedThreshold,
      });

      expect(hasActiveLaunch()).toBe(true);
      expect(useGameStore.getState().launchPopup).toMatchObject({ label: 'AIR!' });
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
