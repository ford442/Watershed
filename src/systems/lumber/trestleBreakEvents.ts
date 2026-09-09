import type { Vec3 } from '../../vehicles/utils/shelfLaunch';

export const TRESTLE_BREAK_EVENT = 'trestleBreak' as const;

export interface TrestleBreakEventDetail {
  /** Authored segment index the trestle spans. */
  segmentIndex: number;
  /** Stable plank index within the span (see TrestleSpan.planks). */
  plankIndex: number;
  /** World-space impact point. */
  impactPoint: Vec3;
  /** Player speed at impact (m/s). */
  impactSpeed: number;
  /** Deck washout at the run's launch hour, 0–1. */
  washout: number;
}

/** Emit when a deck board is knocked loose and goes dynamic. */
export function emitTrestleBreak(detail: TrestleBreakEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TrestleBreakEventDetail>(TRESTLE_BREAK_EVENT, { detail }));
}
