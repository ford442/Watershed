/**
 * What placement reads beyond the segment's geometry (#487 D; split out of
 * `terrain/placement.ts` in #559 C). Plain data, so it crosses to the sim
 * worker with the mesh spec.
 */

import type { PlacementCategory } from './format';

/**
 * Everything placement reads about the segment beyond its geometry: biome
 * flags and densities resolved by the caller (the module never imports biome
 * tables). Plain data, so it crosses to the sim worker.
 */
export interface PropLayoutSpec {
  segmentType: string;
  isSlotCanyon: boolean;
  isGlacier: boolean;
  isAutumnLike: boolean;
  isSummerLike: boolean;
  isLumberFlume: boolean;
  flowSpeed: number;
  wallHeight: number;
  lodQuality: string;
  particleCount: number;
  rockDensity: string;
  treeDensity: number;
}

/** An authored decoration (`DecorationPlacement` plus `snap`). */
export interface PlacementOverride {
  localX: number;
  localZ: number;
  scale?: number;
  rotation?: number;
  rockType?: string;
  /** Height and normal from the tile (default). `false` keeps the legacy guessed height and binormal frame. */
  snap?: boolean;
}

/** What crosses to the worker with the mesh spec. */
export interface SegmentPlacementInput {
  mapId: string;
  layout: PropLayoutSpec;
  /** Authored rocks / trees for the segment; null = procedural. */
  rocks: PlacementOverride[] | null;
  trees: PlacementOverride[] | null;
}

/** Per-category count caps; each is a strict prefix of the uncapped list. */
export type PlacementCaps = Partial<Record<PlacementCategory, number>>;
