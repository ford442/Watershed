/**
 * GameEvents.ts — the game's one event bus, typed (#503 C).
 *
 * Replaces ad-hoc `window.dispatchEvent(new CustomEvent('…'))`: 20 event names,
 * `as CustomEvent` casts at every listener, no map of who sends what, and 8+
 * events nobody listened to. Every event here has a `GameEventMap` entry and
 * at least one `gameEvents.on` call site (`GameEvents.test.ts` checks both
 * against the source), and nothing else in `src/` may dispatch on `window`
 * (ESLint `no-restricted-syntax`).
 *
 * Private listener lists, not `window`: listeners cannot collide with DOM
 * events, the bus runs in Node (the headless campaign, #556), and tests reset
 * it with `gameEvents.clear()`.
 */
import type { SurfaceMaterial } from '../vehicle/VehicleSystem';
import type { HazardKind, HazardPhase } from '../hazards/hazardTypes';
import type { AirTier } from '../score/scoreLaunch';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface CameraShakeDetail {
  intensity: number;
  /** Seconds. */
  duration: number;
  frequency?: number;
  /** Peak roll (radians). */
  angular?: number;
}

export interface SegmentEnterDetail {
  segmentIndex: number;
  flowSpeed: number;
  gravityMultiplier?: number;
  slipperiness: number;
  segmentState: string;
  surviveBonus: number;
  washedOutGap: boolean;
  forceVehicle: 'runner' | 'raft' | null;
}

export interface WaterFlowDetail {
  flowSpeed: number;
  turbulence: number;
  state: string;
  point?: [number, number, number];
}

export interface RunResetDetail {
  biome?: string;
  flowSpeed?: number;
  segmentIndex?: number;
}

export interface PillarBreakDetail {
  /** Authored segment index where the pillar lived. */
  segmentIndex: number;
  /** Stable pillar id within the segment (instance index). */
  pillarIndex: number;
  /** World-space impact point. */
  impactPoint: Vec3Like;
  /** Player speed at impact (m/s). */
  impactSpeed: number;
  /** Number of physics fragments spawned (0 if pool was full). */
  fragmentCount: number;
}

export interface TrestleBreakDetail {
  /** Authored segment index the trestle spans. */
  segmentIndex: number;
  /** Stable plank index within the span (see TrestleSpan.planks). */
  plankIndex: number;
  /** World-space impact point. */
  impactPoint: Vec3Like;
  /** Player speed at impact (m/s). */
  impactSpeed: number;
  /** Deck washout at the run's launch hour, 0–1. */
  washout: number;
}

/** A hazard entered a lifecycle phase (#522; hazardTypes.ts). Telegraph cues listen for it. */
export interface HazardPhaseDetail {
  hazardId: string;
  kind: HazardKind;
  segmentIndex: number;
  phase: HazardPhase;
  /** Anchor in world space as the step saw it (null when its segment was not live). */
  anchor: Vec3Like | null;
}

/** An active hazard reached the player and its consequence was applied (#522). */
export interface HazardHitDetail {
  hazardId: string;
  kind: HazardKind;
  segmentIndex: number;
  wetness: number;
  chill: number;
}

export interface ShelfLaunchDetail {
  bodyHandle: number;
  launchPos: Vec3Like;
  downstreamSpeed: number;
}

/**
 * Vehicle cues (#556 A). The physics steps report what happened — a jump, a
 * landing, a footstep, an impact — and never call audio, the camera or a
 * particle pool themselves, so the step runs with no listener at all (the
 * headless campaign). The vehicle's R3F host subscribes (`runnerCues.ts`,
 * `raftCues.ts`). A cue's detail is valid only during the emit: hot cues
 * (footsteps) reuse one payload object, so a listener copies what it keeps.
 */
export type VehicleKind = 'runner' | 'raft';

export interface VehicleJumpDetail {
  /** Horizontal speed at take-off (m/s): the jump sound's pitch. */
  speed: number;
  /** The air jump (the second jump), not a take-off. */
  double: boolean;
}

export interface VehicleFootstepDetail {
  material: 'moss' | 'rock';
  /** Running in the shallows. */
  wet: boolean;
}

export interface VehicleShakeDetail {
  vehicle: VehicleKind;
  intensity: number;
  /** Seconds; the shake's default when omitted. */
  duration?: number;
}

/** A hard hit: the vehicle's collision burst at `point` (copy it). */
export interface VehicleImpactDetail {
  vehicle: VehicleKind;
  material: SurfaceMaterial;
  point: Vec3Like;
  /** Burst strength, 0–1. */
  intensity: number;
}

/** A shelf launch's valid landing (LaunchScoringSession): the reward before combo / multiplier. */
export interface LaunchScoredDetail {
  tier: AirTier;
  score: number;
  comboDelta: number;
  clean: boolean;
  airTimeSec: number;
}

/** Event name → payload. `void` events carry no detail. */
export interface GameEventMap {
  'biome-change': { biome: string; segmentIndex?: number };
  'boost-triggered': { intensity: number; duration: number };
  /** Continuous low rumble level (0 = off); replaces, does not stack. */
  'camera-rumble': { intensity: number };
  'camera-shake': CameraShakeDetail;
  /** A vehicle or a breaking prop hit a surface hard enough to be heard. */
  'collision-sound': { material: SurfaceMaterial; force: number; point: Vec3Like };
  'hazard-hit': HazardHitDetail;
  'hazard-phase': HazardPhaseDetail;
  'player-near-miss': { speed: number };
  'segment-enter': SegmentEnterDetail;
  'segment-spawn': { segmentIndex: number; spawnPoint: Vec3Like };
  'segment-spawns': { points: Record<number, Vec3Like> };
  'water-flow-update': WaterFlowDetail;
  'watershed-run-reset': RunResetDetail;
  pillarBreak: PillarBreakDetail;
  trestleBreak: TrestleBreakDetail;
  shelfLaunch: ShelfLaunchDetail;
  /** A launch session opened; `label` is the predicted tier (the HUD popup). */
  'launch-started': { label: string };
  'launch-scored': LaunchScoredDetail;
  'vehicle-jump': VehicleJumpDetail;
  /** Touch-down after air time; `impactSpeed` is |v.y| (m/s). */
  'vehicle-land': { impactSpeed: number };
  'vehicle-footstep': VehicleFootstepDetail;
  'vehicle-dodge': void;
  /** A one-shot camera shake the vehicle asked for (the host adds the haptic pulse). */
  'vehicle-shake': VehicleShakeDetail;
  'vehicle-impact': VehicleImpactDetail;
  'raft-paddle': { side: 'left' | 'right' };
  'raft-splash': { intensity: number };
  'raft-tip': void;
}

export type GameEventName = keyof GameEventMap;

type Handler<K extends GameEventName> = (detail: GameEventMap[K]) => void;
type AnyHandler = (detail: never) => void;

const NO_HANDLERS: readonly AnyHandler[] = [];

/** A listener threw: report it like an EventTarget would and keep delivering. */
function reportListenerError(err: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(err);
  else console.error('[gameEvents] listener threw', err);
}

class GameEventBus {
  /**
   * Listeners per event, copy-on-write: `on` / `off` replace the array, so an
   * emit walks a snapshot without copying it and allocates nothing of its own
   * (the vehicle step emits footsteps every few steps, #556 A). Delivery order
   * is subscription order, as it was on the EventTarget this replaced.
   */
  private handlers = new Map<GameEventName, readonly AnyHandler[]>();

  /** Deliver `detail` to every current listener of `type`, synchronously. */
  emit<K extends GameEventName>(type: K, detail: GameEventMap[K]): void {
    const list = (this.handlers.get(type) ?? NO_HANDLERS) as readonly Handler<K>[];
    for (let i = 0; i < list.length; i += 1) {
      try {
        list[i]!(detail);
      } catch (err) {
        reportListenerError(err);
      }
    }
  }

  /** Listen to `type`; returns the unsubscribe (an effect cleanup as-is). */
  on<K extends GameEventName>(type: K, handler: Handler<K>): () => void {
    // A wrapper per subscription: subscribing one function twice is two listeners, and off() drops its own.
    const listener: Handler<K> = (detail) => handler(detail);
    this.handlers.set(type, [...(this.handlers.get(type) ?? NO_HANDLERS), listener as AnyHandler]);
    return () => {
      const list = this.handlers.get(type);
      if (!list) return;
      const at = list.indexOf(listener as AnyHandler);
      if (at < 0) return;
      const next = list.slice();
      next.splice(at, 1);
      if (next.length > 0) this.handlers.set(type, next);
      else this.handlers.delete(type);
    };
  }

  /** Drop every listener (tests). */
  clear(): void {
    this.handlers = new Map();
  }
}

export const gameEvents = new GameEventBus();
