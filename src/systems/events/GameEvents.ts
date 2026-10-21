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
 * A private EventTarget, not `window`: listeners cannot collide with DOM
 * events, and tests reset it with `gameEvents.clear()`.
 */
import type { SurfaceMaterial } from '../vehicle/VehicleSystem';

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

export interface ShelfLaunchDetail {
  bodyHandle: number;
  launchPos: Vec3Like;
  downstreamSpeed: number;
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
  'player-near-miss': { speed: number };
  'segment-enter': SegmentEnterDetail;
  'segment-spawn': { segmentIndex: number; spawnPoint: Vec3Like };
  'segment-spawns': { points: Record<number, Vec3Like> };
  'water-flow-update': WaterFlowDetail;
  'watershed-run-reset': RunResetDetail;
  pillarBreak: PillarBreakDetail;
  trestleBreak: TrestleBreakDetail;
  shelfLaunch: ShelfLaunchDetail;
}

export type GameEventName = keyof GameEventMap;

type Handler<K extends GameEventName> = (detail: GameEventMap[K]) => void;

class GameEventBus {
  private target = new EventTarget();

  /** Deliver `detail` to every current listener of `type`, synchronously. */
  emit<K extends GameEventName>(type: K, detail: GameEventMap[K]): void {
    this.target.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Listen to `type`; returns the unsubscribe (an effect cleanup as-is). */
  on<K extends GameEventName>(type: K, handler: Handler<K>): () => void {
    const listener = (event: Event) => handler((event as CustomEvent<GameEventMap[K]>).detail);
    this.target.addEventListener(type, listener);
    return () => this.target.removeEventListener(type, listener);
  }

  /** Drop every listener (tests). */
  clear(): void {
    this.target = new EventTarget();
  }
}

export const gameEvents = new GameEventBus();
