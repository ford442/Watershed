import type { Vec3 } from '../../vehicles/utils/shelfLaunch';

export const PILLAR_BREAK_EVENT = 'pillarBreak' as const;

export interface PillarBreakEventDetail {
  /** Authored segment index where the pillar lived. */
  segmentIndex: number;
  /** Stable pillar id within the segment (instance index). */
  pillarIndex: number;
  /** World-space impact point. */
  impactPoint: Vec3;
  /** Player speed at impact (m/s). */
  impactSpeed: number;
  /** Number of physics fragments spawned (0 if pool was full). */
  fragmentCount: number;
}

/** Emit when a crumbling pillar shatters (ScoreSystem #273 listens later). */
export function emitPillarBreak(detail: PillarBreakEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PillarBreakEventDetail>(PILLAR_BREAK_EVENT, { detail }));
}
