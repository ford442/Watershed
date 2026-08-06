import type * as React from 'react';
import type * as THREE from 'three';

/**
 * Shared placement contract for biome decoration components.
 * Most Environment/*.jsx hosts accept a subset of these fields.
 */
export interface BiomeDecorationTransform {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

export interface BiomeDecorationProps {
  /** Instanced transforms from TrackSegment placement. */
  transforms?: BiomeDecorationTransform[];
  /** Segment flow speed — drives wind/scroll rates. */
  flowSpeed?: number;
  /** World-space player/vehicle velocity for rustle effects. */
  playerVelocityRef?: React.RefObject<THREE.Vector3 | null>;
  /** Slot-canyon segments tighten fog/mist behaviour. */
  isSlotCanyon?: boolean;
  /** Active biome id for palette selection. */
  biome?: string;
}

export interface WeatherAwareDecorationProps extends BiomeDecorationProps {
  /** Optional explicit weather override (defaults to window `weather-update`). */
  weatherType?: string;
}
