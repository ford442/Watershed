/**
 * hazardLifecycle — one hazard's `dormant → armed → telegraph → active → spent`
 * as a pure step function (#522 A).
 *
 * No world access: the sim system (hazardSimSystem.ts) samples what a hazard
 * reads — whether it is live at the launch hour, the player's horizontal
 * distance to its anchor, the SWE stage there — and hands it in. So the
 * lifecycle is the same code in a real frame, a replay and a unit test.
 *
 * At most one thing happens per step: a phase change, or the player being
 * reached by an active hazard (once per activation). A hazard enters `active`
 * on one step and can reach the player from the next.
 */
import {
  HAZARD_DEFAULT_ACTIVE_SECONDS,
  HAZARD_DEFAULT_ARM_DISTANCE,
  HAZARD_DEFAULT_RADIUS,
  HAZARD_DEFAULT_TELEGRAPH_SECONDS,
  HAZARD_MIN_TELEGRAPH_SECONDS,
  type HazardConfig,
  type HazardPhase,
  type HazardTrigger,
} from './hazardTypes';
import { isHydroEventActiveAtHour, normalizeHour, type HydroEvent } from '../water/hydroEvents';

/** A phase's clock this close under its length still ends it (float residue of 1/60 sums). */
const PHASE_EPSILON = 1e-6;

export interface HazardRuntime {
  readonly config: HazardConfig;
  phase: HazardPhase;
  /** Sim seconds spent in `phase`. */
  phaseTime: number;
  /** The player has been reached during this activation. */
  hit: boolean;
}

/** What the sim sampled for one hazard this step. */
export interface HazardStepInput {
  /** Live at the run's launch hour (its `hours`, or its hydro event's). */
  live: boolean;
  /** Horizontal metres from the player to the anchor; null when either is unknown. */
  distance: number | null;
  /** SWE stage η (m) at the anchor; null with no field there. */
  stage: number | null;
}

/** What a step did: entered a phase, reached the player, or nothing. */
export type HazardStepEvent = HazardPhase | 'hit' | null;

/**
 * Whether a hazard runs at all on a run launched at `hour`. One that follows a
 * hydro event is live exactly when that event is (and, if it also names
 * `hours`, at those of them); a missing event id means never — the registry
 * contract test keeps authored maps from shipping one.
 */
export function isHazardLiveAtHour(
  config: HazardConfig,
  hour: number,
  hydroEvents: readonly HydroEvent[],
): boolean {
  const h = normalizeHour(hour);
  if (config.hours && config.hours.length > 0 && !config.hours.some((c) => normalizeHour(c) === h)) return false;
  if (config.hydroEventId === undefined) return true;
  const event = hydroEvents.find((e) => e.id === config.hydroEventId);
  return event !== undefined && isHydroEventActiveAtHour(event, h);
}

export function createHazardRuntime(config: HazardConfig): HazardRuntime {
  return { config, phase: 'dormant', phaseTime: 0, hit: false };
}

/** Back to the top of a run. */
export function resetHazardRuntime(rt: HazardRuntime): void {
  rt.phase = 'dormant';
  rt.phaseTime = 0;
  rt.hit = false;
}

const within = (distance: number | null, limit: number): boolean => distance !== null && distance <= limit;

function triggerFires(trigger: HazardTrigger, input: HazardStepInput, armedFor: number): boolean {
  switch (trigger.type) {
    case 'proximity':
      return within(input.distance, trigger.distance);
    case 'stage':
      if (input.stage === null) {
        // No field to read (SWE off at Low): a gated stage trigger still fires on proximity.
        return trigger.distance !== undefined && within(input.distance, trigger.distance);
      }
      return (
        input.stage >= trigger.above &&
        (trigger.distance === undefined || within(input.distance, trigger.distance))
      );
    case 'delay':
      return armedFor >= trigger.seconds - PHASE_EPSILON;
  }
}

function enter(rt: HazardRuntime, phase: HazardPhase): HazardPhase {
  rt.phase = phase;
  rt.phaseTime = 0;
  return phase;
}

/** Advance one hazard by one fixed step of `dt` seconds. */
export function stepHazard(rt: HazardRuntime, input: HazardStepInput, dt: number): HazardStepEvent {
  const c = rt.config;
  rt.phaseTime += dt;
  switch (rt.phase) {
    case 'dormant':
      return input.live && within(input.distance, c.armDistance ?? HAZARD_DEFAULT_ARM_DISTANCE)
        ? enter(rt, 'armed')
        : null;
    case 'armed':
      return triggerFires(c.trigger, input, rt.phaseTime) ? enter(rt, 'telegraph') : null;
    case 'telegraph': {
      const warn = Math.max(HAZARD_MIN_TELEGRAPH_SECONDS, c.telegraphSeconds ?? HAZARD_DEFAULT_TELEGRAPH_SECONDS);
      if (rt.phaseTime < warn - PHASE_EPSILON) return null;
      rt.hit = false;
      return enter(rt, 'active');
    }
    case 'active':
      if (rt.phaseTime >= (c.activeSeconds ?? HAZARD_DEFAULT_ACTIVE_SECONDS) - PHASE_EPSILON) {
        return enter(rt, 'spent');
      }
      if (!rt.hit && within(input.distance, c.radius ?? HAZARD_DEFAULT_RADIUS)) {
        rt.hit = true;
        return 'hit';
      }
      return null;
    case 'spent':
      return null;
  }
}
