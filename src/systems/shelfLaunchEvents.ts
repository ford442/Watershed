import type { Vec3 } from './scoreLaunch';

export const SHELF_LAUNCH_EVENT = 'shelfLaunch' as const;

export interface ShelfLaunchEventDetail {
  bodyHandle: number;
  launchPos: Vec3;
  downstreamSpeed: number;
}

/** Emit the shelf launch impulse event (vehicles fire; LaunchScoringSession listens). */
export function emitShelfLaunch(detail: ShelfLaunchEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ShelfLaunchEventDetail>(SHELF_LAUNCH_EVENT, { detail }));
}
