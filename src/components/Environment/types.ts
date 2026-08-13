import type * as React from 'react';
import type { PlacementTransform } from '../TrackSegment/types';

export type { PlacementTransform };

/**
 * Shared placement contract for biome decoration components.
 * Most Environment/*.tsx hosts accept a subset of these fields.
 * Matches `PlacementTransform` from `TrackSegment/types.ts` — the shape
 * `usePlacementData` actually produces (THREE.Vector3/Euler, not tuples).
 */
export interface BiomeDecorationProps {
  /** Instanced transforms from TrackSegment placement. */
  transforms?: PlacementTransform[];
  /** Segment flow speed — drives wind/scroll rates. */
  flowSpeed?: number;
  /** Player/vehicle speed (scalar, units/sec) for rustle/wake effects. */
  playerVelocityRef?: React.RefObject<number>;
  /** Slot-canyon segments tighten fog/mist behaviour. */
  isSlotCanyon?: boolean;
  /** Active biome id for palette selection. */
  biome?: string;
}

export interface WeatherAwareDecorationProps extends BiomeDecorationProps {
  /** Optional explicit weather override (defaults to window `weather-update`). */
  weatherType?: string;
}
